import { createHash, createHmac, timingSafeEqual } from "node:crypto";
import type { Principal } from "@shared/ports/token-verifier.port";

/** A signing key and its short, non-secret identifier (put in the token so verify picks the right key). */
export interface SigningKey {
  readonly kid: string;
  readonly secret: string;
}

/** The set of keys a token may be signed with: `primary` signs new tokens; any in `byKid` verify. */
export interface Keyring {
  readonly primary: SigningKey;
  readonly byKid: ReadonlyMap<string, string>;
}

export interface TokenConfig {
  readonly keyring: Keyring;
  readonly iss: string;
  readonly aud: string;
  readonly ttlMs: number;
}

export interface TokenClaims {
  /** Subject — the user id. */
  readonly sub: string;
  readonly email: string;
  readonly role: string;
  /** The operator's tenant. Optional so tokens issued before multi-tenancy still verify. */
  readonly org?: string;
  readonly iss: string;
  readonly aud: string;
  /** Unique token id, for revocation. */
  readonly jti: string;
  /** Issued-at / expiry, epoch ms. */
  readonly iat: number;
  readonly exp: number;
  /** Id of the key this token was signed with. */
  readonly kid: string;
}

/** A stable, non-secret id for a key — lets verify select the key without revealing it. */
export function deriveKid(secret: string): string {
  return createHash("sha256").update(secret).digest("hex").slice(0, 8);
}

/**
 * Build a keyring from the primary secret and any previous secrets still in rotation. New tokens
 * sign with the primary; tokens signed by a previous key keep verifying until they expire, so a
 * secret can be rotated with zero forced logouts (add new as primary, keep old as previous, drop
 * the old one once its tokens have aged out).
 */
export function buildKeyring(primarySecret: string, previousSecrets: readonly string[] = []): Keyring {
  const primary: SigningKey = { kid: deriveKid(primarySecret), secret: primarySecret };
  const byKid = new Map<string, string>([[primary.kid, primarySecret]]);
  for (const s of previousSecrets) if (s) byKid.set(deriveKid(s), s);
  return { primary, byKid };
}

/** Skew allowance so a token issued a moment "ahead" of the verifier's clock isn't rejected. */
const CLOCK_SKEW_MS = 60_000;

export function signToken(cfg: TokenConfig, principal: Principal, jti: string, now: number): string {
  const claims: TokenClaims = {
    sub: principal.userId,
    email: principal.email,
    role: principal.role,
    org: principal.orgId,
    iss: cfg.iss,
    aud: cfg.aud,
    jti,
    iat: now,
    exp: now + cfg.ttlMs,
    kid: cfg.keyring.primary.kid,
  };
  const body = encode(claims);
  return `${body}.${sign(body, cfg.keyring.primary.secret)}`;
}

/** Verify signature and standard claims, returning the claims (for revocation checks) or null. */
export function verifyToken(cfg: TokenConfig, token: string, now: number): TokenClaims | null {
  const [body, signature] = token.split(".");
  if (!body || !signature) return null;

  let claims: TokenClaims;
  try {
    claims = JSON.parse(Buffer.from(body, "base64url").toString()) as TokenClaims;
  } catch {
    return null;
  }

  const secret = typeof claims.kid === "string" ? cfg.keyring.byKid.get(claims.kid) : undefined;
  if (!secret) return null; // unknown or rotated-out key

  const expected = sign(body, secret);
  const a = Buffer.from(signature);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return null;

  if (claims.iss !== cfg.iss || claims.aud !== cfg.aud) return null;
  if (typeof claims.exp !== "number" || claims.exp < now) return null;
  if (typeof claims.iat !== "number" || claims.iat > now + CLOCK_SKEW_MS) return null;
  return claims;
}

const encode = (o: unknown) => Buffer.from(JSON.stringify(o)).toString("base64url");
const sign = (data: string, secret: string) => createHmac("sha256", secret).update(data).digest("base64url");
