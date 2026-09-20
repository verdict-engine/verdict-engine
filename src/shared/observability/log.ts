type Level = "info" | "warn" | "error";

const SENSITIVE = /pass|secret|token|key|authorization|pan|card/i;

/**
 * One structured line per operational event, so logs are queryable and safe. Never pass raw
 * PII or credentials — obviously-sensitive keys are redacted as a backstop, not a licence.
 */
export function logEvent(level: Level, event: string, fields: Record<string, unknown> = {}): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), level, event, ...scrub(fields) });
  // eslint-disable-next-line no-console
  const sink = level === "error" ? console.error : level === "warn" ? console.warn : console.log;
  sink(line);
}

/** The scrubbed message of an unknown thrown value — never its stack or arbitrary shape. */
export function causeMessage(cause: unknown): string {
  return cause instanceof Error ? cause.message : "unknown error";
}

function scrub(fields: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(fields)) out[k] = SENSITIVE.test(k) ? "[redacted]" : v;
  return out;
}
