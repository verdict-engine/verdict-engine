import { buildKeyring, type TokenConfig } from "../domain/token";

export const TOKEN_CONFIG = Symbol("TokenConfig");

const TTL_MS = 1000 * 60 * 60 * 12; // 12h

/**
 * Assemble the token config from the environment. AUTH_SECRET is the primary signing key;
 * AUTH_SECRET_PREVIOUS (comma-separated) holds secrets still in rotation so their tokens keep
 * verifying. iss/aud pin the token to this issuer and audience.
 */
export function buildTokenConfig(env: NodeJS.ProcessEnv = process.env): TokenConfig {
  const primary = env.AUTH_SECRET || "dev-secret-change-me";
  const previous = (env.AUTH_SECRET_PREVIOUS ?? "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  return {
    keyring: buildKeyring(primary, previous),
    iss: env.AUTH_ISSUER || "verdict-engine",
    aud: env.AUTH_AUDIENCE || "verdict-operators",
    ttlMs: TTL_MS,
  };
}
