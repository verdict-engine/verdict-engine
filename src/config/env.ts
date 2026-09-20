export interface EngineConfig {
  nodeEnv: string;
  port: number;
  authSecret: string;
  databaseUrl?: string;
  persistence: "postgres" | "memory";
  redisUrl?: string;
  /** Express `trust proxy` setting — how many/which proxy hops to trust for the client IP. */
  trustProxy: boolean | number | string;
}

export interface ConfigResult {
  config: EngineConfig;
  warnings: string[];
}

const INSECURE_DEFAULT = "dev-secret-change-me";

/**
 * Values that satisfy a naive length check but are obviously not real secrets — the compose
 * fallback, common templates, and repeated-char filler. Rejected outright in production so a
 * placeholder can never sign real tokens. Compared case-insensitively.
 */
const PLACEHOLDER_SECRETS = new Set(
  [
    INSECURE_DEFAULT,
    "change-me-in-production-min-16-chars",
    "changeme",
    "change-me",
    "change_me",
    "changemechangeme",
    "your-secret-here",
    "please-change-me",
    "secret",
    "supersecret",
    "auth-secret",
    "0000000000000000",
  ].map((s) => s.toLowerCase()),
);

function isPlaceholderSecret(value: string): boolean {
  const v = value.trim().toLowerCase();
  if (PLACEHOLDER_SECRETS.has(v)) return true;
  // A single repeated character (e.g. "aaaaaaaaaaaaaaaa") is filler, not entropy.
  return v.length > 0 && /^(.)\1+$/.test(v);
}

/**
 * Validates the environment BEFORE the app boots, so a misconfigured deploy fails
 * fast with a clear message instead of coming up silently insecure or without a
 * database. In production, a real AUTH_SECRET and a Postgres DATABASE_URL are
 * required; in dev, missing values fall back with a warning.
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): ConfigResult {
  const nodeEnv = env.NODE_ENV ?? "development";
  const isProd = nodeEnv === "production";
  const errors: string[] = [];
  const warnings: string[] = [];

  const port = env.PORT ? Number(env.PORT) : 4000;
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    errors.push(`PORT must be a valid port number (got "${env.PORT}").`);
  }

  const authSecret = env.AUTH_SECRET ?? "";
  if (isProd) {
    if (!authSecret) errors.push("AUTH_SECRET is required in production — it signs operator tokens. Generate one: openssl rand -hex 32");
    else if (isPlaceholderSecret(authSecret)) errors.push("AUTH_SECRET is a placeholder, not a real secret. Generate one: openssl rand -hex 32");
    else if (authSecret.length < 16) errors.push("AUTH_SECRET must be at least 16 characters.");
  } else if (!authSecret || isPlaceholderSecret(authSecret)) {
    warnings.push("AUTH_SECRET not set (or a placeholder) — using an insecure development default. Set a real one before production.");
  }

  const forceMemory = env.PERSISTENCE === "memory";
  const databaseUrl = env.DATABASE_URL;
  let persistence: "postgres" | "memory" = "memory";

  if (databaseUrl) {
    if (!/^postgres(ql)?:\/\//.test(databaseUrl)) {
      errors.push('DATABASE_URL must be a postgres:// connection string.');
    }
    persistence = "postgres";
  } else if (isProd && !forceMemory) {
    errors.push("DATABASE_URL is required in production for durable persistence. Set it, or set PERSISTENCE=memory to explicitly accept a non-persistent deploy.");
  } else if (!forceMemory) {
    warnings.push("DATABASE_URL not set — using the in-memory store; data will NOT persist across restarts.");
  }

  const redisUrl = env.REDIS_URL;
  if (redisUrl && !/^rediss?:\/\//.test(redisUrl)) {
    errors.push("REDIS_URL must be a redis:// or rediss:// connection string.");
  } else if (!redisUrl && isProd) {
    warnings.push("REDIS_URL not set — idempotency, velocity and rate limits are per-replica. Set it (and run one engine replica without it).");
  }

  const trustProxy = parseTrustProxy(env.TRUST_PROXY);
  if (isProd && trustProxy === false) {
    warnings.push("TRUST_PROXY not set — X-Forwarded-For is ignored, so per-IP rate limits use the socket address. Behind a proxy, set TRUST_PROXY (e.g. 1) or per-IP limits see only the proxy's IP.");
  }

  if (errors.length > 0) throw new ConfigError(errors);

  return {
    config: { nodeEnv, port, authSecret: authSecret || INSECURE_DEFAULT, databaseUrl, persistence, redisUrl, trustProxy },
    warnings,
  };
}

/**
 * Maps TRUST_PROXY to an Express `trust proxy` value. Default is `false` — do NOT trust
 * X-Forwarded-For, so a client cannot spoof its IP to dodge per-IP limits. Behind a proxy set a
 * hop count (e.g. `1`), `true`, or a subnet list; those are passed to Express verbatim.
 */
function parseTrustProxy(raw: string | undefined): boolean | number | string {
  if (raw === undefined || raw === "" || raw === "false" || raw === "0") return false;
  if (raw === "true") return true;
  const n = Number(raw);
  return Number.isInteger(n) && n >= 0 ? n : raw;
}

export class ConfigError extends Error {
  constructor(readonly problems: string[]) {
    super(`invalid configuration:\n${problems.map((p) => `  - ${p}`).join("\n")}`);
    this.name = "ConfigError";
  }

  pretty(): string {
    return [
      "",
      "  ✗ verdict-engine cannot start — fix these environment variables:",
      "",
      ...this.problems.map((p) => `    • ${p}`),
      "",
    ].join("\n");
  }
}
