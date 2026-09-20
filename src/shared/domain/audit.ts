/** One recorded administrative action — who changed what, and when. Append-only. */
export interface AuditEntry {
  readonly id: string;
  readonly at: string;
  /** The operator who made the change (email), or "system". */
  readonly actor: string;
  readonly role?: string;
  /** HTTP method + path of the mutation, e.g. "PUT /v1/config/rate-limits". */
  readonly action: string;
  /** Result HTTP status. */
  readonly status: number;
  /** The request body, with secret-ish values redacted. Omitted when empty. */
  readonly params?: unknown;
}

export interface AuditView extends AuditEntry {}

const SECRET_KEY = /(secret|password|token|url|authorization|chat_id|apikey|api_key|plaintext)/i;
const MAX_STRING = 512;

/**
 * Redact secret-ish values from a request body before it's stored in the audit log. Config changes
 * are worth recording, but a channel URL or a Telegram token in the body is not — the audit trail
 * must never become a place secrets leak to. Recurses into objects/arrays and caps long strings.
 */
export function redactBody(value: unknown, depth = 0): unknown {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redactBody(v, depth + 1));
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEY.test(k) ? "[redacted]" : redactBody(v, depth + 1);
    }
    return out;
  }
  if (typeof value === "string" && value.length > MAX_STRING) return `${value.slice(0, MAX_STRING)}…`;
  return value;
}
