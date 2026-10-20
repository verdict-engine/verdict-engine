/**
 * Traffic simulator — a closed-loop, real-time load + validation harness.
 *
 * It drives a running engine with a realistic stream of payment events (a legit baseline plus
 * labeled fraud archetypes crafted to trip the real signals), measures latency/throughput under
 * paced concurrency, feeds confirmed fraud back as chargebacks, then reads GET /v1/shadow/report
 * to measure what the policy would have caught — cross-checked against the ground truth it injected.
 *
 * Run against a local engine:
 *   npm run simulate                      # bootstraps auth, 2000 events, shadow mode
 *   npm run simulate -- --events 5000 --rps 400 --concurrency 100
 *   VERDICT_API_KEY=vk_live_… VERDICT_TOKEN=… npm run simulate   # use existing credentials
 *
 * Nothing here is app code — it is an idempotent operator script that speaks only the public API.
 */

const DEFAULTS = {
  url: process.env.VERDICT_URL ?? "http://localhost:4000",
  events: 2000,
  rps: 200,
  concurrency: 50,
  fraudRate: 0.08,
  labelRate: 0.9,
  windowDays: 30,
  mode: "shadow" as "shadow" | "enforce",
};

type Verdict = "allow" | "challenge" | "review" | "deny";
type Archetype = "legit" | "ato_cashout" | "card_testing";

interface SimEvent {
  type: "payment.authorize";
  id: string;
  subject: { userId: string; deviceId?: string; ip?: string; phone?: string; channel?: string };
  amount?: number;
  currency?: string;
  instrument?: { kind: "card" | "wallet" | "bank"; bin?: string; issuerCountry?: string; threeDS?: boolean };
  attributes?: Record<string, string | number | boolean>;
}

interface PlannedEvent {
  event: SimEvent;
  fraud: boolean;
  archetype: Archetype;
}

interface DecisionResponse {
  id: string;
  verdict: Verdict;
  score: number;
  shadow?: boolean;
}

interface ShadowReport {
  scanned: number;
  total: number;
  byVerdict: Record<string, number>;
  wouldBlockRate: number;
  challengeRate: number;
  labeledFraud: number;
  caught: number;
  missed: number;
  catchRate: number;
}

interface Config {
  url: string;
  events: number;
  rps: number;
  concurrency: number;
  fraudRate: number;
  labelRate: number;
  windowDays: number;
  mode: "shadow" | "enforce";
  apiKey?: string;
  token?: string;
}

const sleep = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
const now = (): string => new Date().toISOString();

function parseArgs(argv: string[]): Config {
  const cfg: Config = { ...DEFAULTS, apiKey: process.env.VERDICT_API_KEY, token: process.env.VERDICT_TOKEN };
  for (let i = 0; i < argv.length; i++) {
    const [flag, inline] = argv[i].split("=");
    const val = inline ?? argv[i + 1];
    const take = (): string => (inline === undefined ? (i++, val) : val);
    switch (flag) {
      case "--url": cfg.url = take(); break;
      case "--events": cfg.events = Number(take()); break;
      case "--rps": cfg.rps = Number(take()); break;
      case "--concurrency": cfg.concurrency = Number(take()); break;
      case "--fraud-rate": cfg.fraudRate = Number(take()); break;
      case "--label-rate": cfg.labelRate = Number(take()); break;
      case "--window-days": cfg.windowDays = Number(take()); break;
      case "--mode": cfg.mode = take() === "enforce" ? "enforce" : "shadow"; break;
      case "--help":
        console.log("Usage: npm run simulate -- [--events N] [--rps R] [--concurrency C] [--fraud-rate F] [--label-rate L] [--mode shadow|enforce] [--window-days D] [--url URL]");
        process.exit(0);
    }
  }
  return cfg;
}

// --- HTTP helpers -------------------------------------------------------------

async function postJson<T>(url: string, body: unknown, headers: Record<string, string>): Promise<{ ok: boolean; status: number; body: T | null }> {
  try {
    const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json", ...headers }, body: JSON.stringify(body) });
    const text = await res.text();
    const parsed = text ? (JSON.parse(text) as T) : null;
    return { ok: res.ok, status: res.status, body: parsed };
  } catch {
    return { ok: false, status: 0, body: null };
  }
}

/** Resolve an operator token + an API key, bootstrapping a fresh engine if none were provided. */
async function resolveCredentials(cfg: Config): Promise<{ apiKey: string; token: string }> {
  let token = cfg.token;
  if (!token) {
    const email = process.env.VERDICT_EMAIL ?? "sim-admin@verdict.local";
    const password = process.env.VERDICT_PASSWORD ?? "sim-password-change-me-32chars!!";
    const login = await postJson<{ token: string }>(`${cfg.url}/v1/auth/login`, { email, password }, {});
    if (login.ok && login.body?.token) {
      token = login.body.token;
    } else {
      const reg = await postJson<{ token: string }>(`${cfg.url}/v1/auth/register`, { email, password }, {});
      if (!reg.ok || !reg.body?.token) {
        throw new Error("could not obtain an operator token — pass VERDICT_TOKEN, or VERDICT_EMAIL/VERDICT_PASSWORD for an engine with an existing admin");
      }
      token = reg.body.token;
    }
  }

  let apiKey = cfg.apiKey;
  if (!apiKey) {
    const key = await postJson<{ plaintext: string }>(
      `${cfg.url}/v1/apikeys`,
      { name: `simulator-${Date.now()}`, scopes: ["decisions", "labels"] },
      { authorization: `Bearer ${token}` },
    );
    if (!key.ok || !key.body?.plaintext) throw new Error("could not mint an API key — pass VERDICT_API_KEY, or ensure the operator token is an admin");
    apiKey = key.body.plaintext;
  }
  return { apiKey, token };
}

// --- Traffic generation -------------------------------------------------------

let seq = 0;
const nextId = (p: string): string => `${p}_${Date.now().toString(36)}${(seq++).toString(36)}`;
const pick = <T>(xs: readonly T[]): T => xs[Math.floor(Math.random() * xs.length)];
const between = (lo: number, hi: number): number => Math.round(lo + Math.random() * (hi - lo));

const ESTABLISHED_USERS = Array.from({ length: 120 }, (_, i) => `usr_known_${i}`);
const KNOWN_DEVICES = Array.from({ length: 120 }, (_, i) => `dev_known_${i}`);
const CHANNELS = ["telebirr", "card-web", "card-app", "mpesa"] as const;

/** A normal, low-risk transaction: established user, known device, matching geo, 3DS. Scores ~0. */
function legitEvent(): PlannedEvent {
  const i = Math.floor(Math.random() * ESTABLISHED_USERS.length);
  return {
    fraud: false,
    archetype: "legit",
    event: {
      type: "payment.authorize",
      id: nextId("evt"),
      subject: { userId: ESTABLISHED_USERS[i], deviceId: KNOWN_DEVICES[i], ip: `196.188.${between(1, 254)}.${between(1, 254)}`, phone: `+2519${between(10, 99)}${between(100000, 999999)}`, channel: pick(CHANNELS) },
      amount: between(50, 2000),
      currency: "ETB",
      instrument: { kind: pick(["card", "wallet", "bank"] as const), bin: "451234", issuerCountry: "ET", threeDS: true },
      attributes: { threeDSCompleted: true },
    },
  };
}

/** Account-takeover cashout: new user + new device + geo/SIM mismatch + high amount. Trips takeover + anomaly. */
function atoCashoutEvent(): PlannedEvent {
  return {
    fraud: true,
    archetype: "ato_cashout",
    event: {
      type: "payment.authorize",
      id: nextId("evt"),
      subject: { userId: nextId("usr_ato"), deviceId: nextId("dev_new"), ip: `45.133.${between(1, 254)}.${between(1, 254)}`, phone: `+2519${between(10, 99)}${between(100000, 999999)}`, channel: pick(CHANNELS) },
      amount: between(3200, 9000),
      currency: "ETB",
      instrument: { kind: "card", bin: "222100", issuerCountry: "RU", threeDS: false },
      attributes: { geoMismatch: true, threeDSCompleted: false },
    },
  };
}

/**
 * Card-testing ring: one compromised identity firing many rapid small auths. Each event trips the
 * velocity rule once attemptsLast2m climbs — but velocity alone lands under the block band, so the
 * demo ruleset *misses* these. That gap is exactly what the shadow report surfaces.
 */
function cardTestingBurst(): PlannedEvent[] {
  const userId = nextId("usr_ring");
  const deviceId = nextId("dev_ring");
  const ip = `185.220.${between(1, 254)}.${between(1, 254)}`;
  const n = between(5, 9);
  return Array.from({ length: n }, () => ({
    fraud: true,
    archetype: "card_testing" as const,
    event: {
      type: "payment.authorize" as const,
      id: nextId("evt"),
      subject: { userId, deviceId, ip, phone: `+2519${between(10, 99)}${between(100000, 999999)}`, channel: "card-web" },
      amount: between(5, 60),
      currency: "ETB",
      instrument: { kind: "card" as const, bin: "400000", issuerCountry: "US", threeDS: false },
      attributes: { cardTesting: true },
    },
  }));
}

/** Build the full event plan: a legit baseline with fraud archetypes mixed in at the configured rate. */
function buildPlan(total: number, fraudRate: number): PlannedEvent[] {
  const plan: PlannedEvent[] = [];
  while (plan.length < total) {
    if (Math.random() < fraudRate) {
      if (Math.random() < 0.5) plan.push(atoCashoutEvent());
      else for (const e of cardTestingBurst()) plan.push(e);
    } else {
      plan.push(legitEvent());
    }
  }
  return plan.slice(0, total);
}

// --- Load driver --------------------------------------------------------------

interface SentResult extends PlannedEvent {
  ok: boolean;
  status: number;
  verdict?: Verdict;
  latencyMs: number;
}

async function drive(plan: PlannedEvent[], cfg: Config, apiKey: string): Promise<SentResult[]> {
  const results: SentResult[] = new Array(plan.length);
  const headers: Record<string, string> = { "x-api-key": apiKey };
  if (cfg.mode === "shadow") headers["x-verdict-mode"] = "shadow";

  const interval = 1000 / cfg.rps;
  const start = performance.now();
  let cursor = 0;

  const worker = async (): Promise<void> => {
    for (;;) {
      const i = cursor++;
      if (i >= plan.length) return;
      const wait = start + i * interval - performance.now();
      if (wait > 0) await sleep(wait);
      const t0 = performance.now();
      const res = await postJson<DecisionResponse>(`${cfg.url}/v1/decisions`, plan[i].event, headers);
      results[i] = { ...plan[i], ok: res.ok, status: res.status, verdict: res.body?.verdict, latencyMs: performance.now() - t0 };
    }
  };

  await Promise.all(Array.from({ length: cfg.concurrency }, worker));
  return results;
}

// --- Feedback loop ------------------------------------------------------------

/** Report chargebacks for a realistic subset of the fraud we injected (ground-truth labels). */
async function reportChargebacks(results: SentResult[], cfg: Config, apiKey: string): Promise<number> {
  const toLabel = results.filter((r) => r.ok && r.fraud && Math.random() < cfg.labelRate);
  let sent = 0;
  const headers = { "x-api-key": apiKey };
  for (let i = 0; i < toLabel.length; i += cfg.concurrency) {
    const batch = toLabel.slice(i, i + cfg.concurrency);
    const outcomes = await Promise.all(batch.map((r) => postJson(`${cfg.url}/v1/labels/chargeback`, { eventId: r.event.id }, headers)));
    sent += outcomes.filter((o) => o.ok).length;
  }
  return sent;
}

// --- Reporting ----------------------------------------------------------------

function percentile(sorted: number[], p: number): number {
  if (sorted.length === 0) return 0;
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
}

const pct = (n: number): string => `${(n * 100).toFixed(1)}%`;
const ms = (n: number): string => `${n.toFixed(1)}ms`;

function printReport(results: SentResult[], cfg: Config, wallSeconds: number, chargebacks: number, report: ShadowReport | null): void {
  const ok = results.filter((r) => r.ok);
  const failed = results.filter((r) => !r.ok);
  const rateLimited = failed.filter((r) => r.status === 429).length;
  const serverErrors = failed.filter((r) => r.status >= 500).length;
  const network = failed.filter((r) => r.status === 0).length;
  const otherErrors = failed.length - rateLimited - serverErrors - network;
  const latencies = ok.map((r) => r.latencyMs).sort((a, b) => a - b);
  const verdictMix: Record<string, number> = {};
  for (const r of ok) if (r.verdict) verdictMix[r.verdict] = (verdictMix[r.verdict] ?? 0) + 1;

  const injectedFraud = results.filter((r) => r.fraud).length;
  const labeledGroundTruth = results.filter((r) => r.ok && r.fraud);
  const blocked = (v?: Verdict): boolean => v === "review" || v === "deny";
  const caughtGroundTruth = labeledGroundTruth.filter((r) => blocked(r.verdict)).length;

  const line = (s = ""): void => console.log(s);
  line();
  line("══════════════════════════════════════════════════════════════");
  line(`  VERDICT TRAFFIC SIMULATION — ${cfg.mode.toUpperCase()} MODE`);
  line("══════════════════════════════════════════════════════════════");
  line();
  line("  LOAD");
  line(`    Events sent ........ ${results.length}  (${ok.length} accepted · ${failed.length} rejected)`);
  line(`    Wall time .......... ${wallSeconds.toFixed(1)}s`);
  line(`    Offered rate ....... ${(results.length / wallSeconds).toFixed(0)} req/s  (target ${cfg.rps})`);
  line(`    Accepted rate ...... ${(ok.length / wallSeconds).toFixed(0)} req/s`);
  line(`    Concurrency ........ ${cfg.concurrency}`);
  line(`    Latency p50 ........ ${ms(percentile(latencies, 50))}  (accepted only)`);
  line(`    Latency p95 ........ ${ms(percentile(latencies, 95))}`);
  line(`    Latency p99 ........ ${ms(percentile(latencies, 99))}`);
  line(`    Latency max ........ ${ms(latencies[latencies.length - 1] ?? 0)}`);
  line(`    Rate-limited (429) . ${rateLimited}${rateLimited > 0 ? "   ← raise the decisions rate limit (Configure) to push throughput higher" : ""}`);
  line(`    Server errors (5xx)  ${serverErrors}`);
  line(`    Network / timeout .. ${network}`);
  if (otherErrors > 0) line(`    Other 4xx .......... ${otherErrors}`);
  line(`    True error rate .... ${pct((serverErrors + network + otherErrors) / Math.max(1, results.length))}  (excludes 429 backpressure)`);
  line();
  line("  VERDICT MIX");
  for (const v of ["allow", "challenge", "review", "deny"] as const) {
    const n = verdictMix[v] ?? 0;
    line(`    ${v.padEnd(10)} ....... ${n}  (${pct(n / Math.max(1, ok.length))})`);
  }
  line();
  line("  GROUND TRUTH (what the simulator injected)");
  line(`    Fraud injected ..... ${injectedFraud}  (ato_cashout + card_testing)`);
  line(`    Chargebacks sent ... ${chargebacks}`);
  line(`    Of fraud, blocked .. ${caughtGroundTruth} / ${labeledGroundTruth.length}  (${pct(caughtGroundTruth / Math.max(1, labeledGroundTruth.length))})`);
  line();
  if (cfg.mode !== "shadow") {
    line("  SHADOW REPORT skipped — run in --mode shadow for the closed-loop catch-rate.");
  } else if (!report) {
    line("  SHADOW REPORT unavailable (could not reach GET /v1/shadow/report).");
  } else {
    line(`  SHADOW REPORT (engine, last ${cfg.windowDays}d)`);
    line(`    Shadow decisions ... ${report.total}  (scanned ${report.scanned})`);
    line(`    Would block ........ ${pct(report.wouldBlockRate)}  (review + deny)`);
    line(`    Would challenge .... ${pct(report.challengeRate)}`);
    line(`    Confirmed fraud .... ${report.labeledFraud}  (chargebacks landed)`);
    line(`    Fraud caught ....... ${pct(report.catchRate)}  (${report.caught} caught · ${report.missed} missed)`);
    line();
    line("  The engine's catch-rate should track the ground-truth block-rate above.");
    line("  A gap below 100% is expected: the demo ruleset catches ATO cashouts but");
    line("  misses velocity-only card-testing rings — the exact gap shadow mode exists to reveal.");
  }
  line();
  line("══════════════════════════════════════════════════════════════");
}

// --- Main ---------------------------------------------------------------------

async function main(): Promise<void> {
  const cfg = parseArgs(process.argv.slice(2));
  console.log(`[${now()}] simulate → ${cfg.url}  events=${cfg.events} rps=${cfg.rps} concurrency=${cfg.concurrency} mode=${cfg.mode}`);

  const health = await fetch(`${cfg.url}/health`).then((r) => r.ok).catch(() => false);
  if (!health) throw new Error(`engine not reachable at ${cfg.url} — start it first (npm run start:dev or docker compose up)`);

  const { apiKey, token } = await resolveCredentials(cfg);
  console.log(`[${now()}] credentials ready — generating ${cfg.events} events…`);

  const plan = buildPlan(cfg.events, cfg.fraudRate);
  console.log(`[${now()}] driving load…`);
  const t0 = performance.now();
  const results = await drive(plan, cfg, apiKey);
  const wallSeconds = (performance.now() - t0) / 1000;

  console.log(`[${now()}] reporting chargebacks…`);
  const chargebacks = await reportChargebacks(results, cfg, apiKey);

  let report: ShadowReport | null = null;
  if (cfg.mode === "shadow") {
    await sleep(500); // let async label processing settle
    try {
      const res = await fetch(`${cfg.url}/v1/shadow/report?days=${cfg.windowDays}&limit=100000`, { headers: { authorization: `Bearer ${token}` } });
      if (res.ok) report = (await res.json()) as ShadowReport;
    } catch {
      report = null;
    }
  }

  printReport(results, cfg, wallSeconds, chargebacks, report);
}

main().catch((e: unknown) => {
  console.error(`\n[simulate] failed: ${e instanceof Error ? e.message : String(e)}`);
  process.exit(1);
});
