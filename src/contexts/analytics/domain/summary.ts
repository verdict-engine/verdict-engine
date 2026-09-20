export interface DayCounts {
  total: number;
  allow: number;
  challenge: number;
  review: number;
  deny: number;
}

export interface AnalyticsSummary {
  totals: { decisions: number; byVerdict: Record<string, number> };
  scoreBuckets: number[];
  topTags: Record<string, number>;
  byDay: Record<string, DayCounts>;
  cases: { resolved: number; fraud: number; legit: number; inconclusive: number };
  labels: { fraud: number; legit: number; analyst: number; chargeback: number };
}

export function emptySummary(): AnalyticsSummary {
  return {
    totals: { decisions: 0, byVerdict: {} },
    scoreBuckets: Array(11).fill(0),
    topTags: {},
    byDay: {},
    cases: { resolved: 0, fraud: 0, legit: 0, inconclusive: 0 },
    labels: { fraud: 0, legit: 0, analyst: 0, chargeback: 0 },
  };
}

interface VerdictFact {
  verdict: string;
  score: number;
  reasons: ReadonlyArray<{ tag: string; points: number }>;
}

/** Fold one verdict into the summary (mutates the draft, returns it). */
export function applyVerdict(s: AnalyticsSummary, fact: VerdictFact, occurredAt: string): AnalyticsSummary {
  s.totals.decisions += 1;
  s.totals.byVerdict[fact.verdict] = (s.totals.byVerdict[fact.verdict] ?? 0) + 1;

  if (fact.score >= 0) {
    const bucket = Math.min(Math.floor(fact.score / 10), 10);
    s.scoreBuckets[bucket] += 1;
  }
  for (const r of fact.reasons) {
    if (r.points > 0) s.topTags[r.tag] = (s.topTags[r.tag] ?? 0) + 1;
  }

  const day = occurredAt.slice(0, 10);
  const d = s.byDay[day] ?? { total: 0, allow: 0, challenge: 0, review: 0, deny: 0 };
  d.total += 1;
  if (fact.verdict in d) (d as unknown as Record<string, number>)[fact.verdict] += 1;
  s.byDay[day] = d;
  return s;
}

export function applyResolution(s: AnalyticsSummary, outcome: string): AnalyticsSummary {
  s.cases.resolved += 1;
  if (outcome === "fraud" || outcome === "legit" || outcome === "inconclusive") s.cases[outcome] += 1;
  return s;
}

/** Fold one ground-truth label — includes chargebacks, which resolutions alone miss. */
export function applyLabel(
  s: AnalyticsSummary,
  fact: { outcome: "fraud" | "legit"; source: "analyst" | "chargeback" },
): AnalyticsSummary {
  s.labels[fact.outcome] += 1;
  s.labels[fact.source] += 1;
  return s;
}

/** legit resolutions as a share of decided (fraud|legit) cases — the engine's false-positive rate. */
export function falsePositiveRate(s: AnalyticsSummary): number {
  const decided = s.cases.fraud + s.cases.legit;
  return decided === 0 ? 0 : s.cases.legit / decided;
}
