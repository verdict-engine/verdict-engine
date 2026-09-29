import { createHash, randomBytes } from "node:crypto";

/** The actions a key may perform. Maps to the two machine endpoints. */
export const API_KEY_SCOPES = ["decisions", "labels"] as const;
export type ApiKeyScope = (typeof API_KEY_SCOPES)[number];

export interface ApiKey {
  readonly id: string;
  readonly name: string;
  readonly hash: string;
  readonly prefix: string;
  readonly createdBy: string;
  /** The tenant this key belongs to — sets the data scope of requests it authenticates. Legacy → default org. */
  readonly orgId?: string;
  readonly createdAt: string;
  readonly revokedAt?: string;
  /** Allowed scopes. Absent/empty = all scopes (keys created before scoping existed). */
  readonly scopes?: string[];
  /** ISO expiry. Absent = never expires. */
  readonly expiresAt?: string;
}

export interface ApiKeySummary {
  id: string;
  name: string;
  prefix: string;
  createdBy: string;
  createdAt: string;
  revoked: boolean;
  scopes: string[];
  expiresAt?: string;
  expired: boolean;
}

/** The scopes a key actually grants — all of them for legacy keys stored without a scope list. */
export function effectiveScopes(k: ApiKey): string[] {
  return k.scopes && k.scopes.length > 0 ? k.scopes : [...API_KEY_SCOPES];
}

export function isExpired(k: ApiKey, nowIso: string): boolean {
  return k.expiresAt !== undefined && k.expiresAt <= nowIso;
}

/**
 * Keys are shown to the caller exactly once. Only the SHA-256 hash is stored — a
 * leaked database never yields a usable key. The prefix is kept for display.
 */
export function generateKey(): { plaintext: string; hash: string; prefix: string } {
  const plaintext = `vk_live_${randomBytes(24).toString("hex")}`;
  return { plaintext, hash: hashKey(plaintext), prefix: plaintext.slice(0, 16) };
}

export function hashKey(key: string): string {
  return createHash("sha256").update(key).digest("hex");
}

export function summarize(k: ApiKey, nowIso?: string): ApiKeySummary {
  return {
    id: k.id,
    name: k.name,
    prefix: k.prefix,
    createdBy: k.createdBy,
    createdAt: k.createdAt,
    revoked: Boolean(k.revokedAt),
    scopes: effectiveScopes(k),
    expiresAt: k.expiresAt,
    expired: nowIso ? isExpired(k, nowIso) : false,
  };
}
