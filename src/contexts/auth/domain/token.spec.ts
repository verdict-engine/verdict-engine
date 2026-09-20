import { describe, expect, it } from "vitest";
import { buildKeyring, deriveKid, signToken, verifyToken, type TokenConfig } from "./token";

const principal = { userId: "usr_1", email: "a@b.com", role: "analyst" };
const NOW = 1_800_000_000_000;

const config = (secret = "primary-secret-value", previous: string[] = []): TokenConfig => ({
  keyring: buildKeyring(secret, previous),
  iss: "verdict-engine",
  aud: "verdict-operators",
  ttlMs: 1000 * 60 * 60,
});

describe("token", () => {
  it("round-trips a signed token with its claims", () => {
    const cfg = config();
    const claims = verifyToken(cfg, signToken(cfg, principal, "jti_1", NOW), NOW);
    expect(claims).toMatchObject({ sub: "usr_1", email: "a@b.com", role: "analyst", jti: "jti_1", iss: "verdict-engine", aud: "verdict-operators" });
  });

  it("rejects a tampered or garbage token", () => {
    const cfg = config();
    const token = signToken(cfg, principal, "jti_1", NOW);
    expect(verifyToken(cfg, `${token}x`, NOW)).toBeNull();
    expect(verifyToken(cfg, "garbage", NOW)).toBeNull();
  });

  it("rejects an expired token", () => {
    const cfg = config();
    const token = signToken(cfg, principal, "jti_1", NOW);
    expect(verifyToken(cfg, token, NOW + cfg.ttlMs + 1)).toBeNull();
  });

  it("rejects a token whose issuer or audience does not match", () => {
    const signed = signToken(config(), principal, "jti_1", NOW);
    const otherIss: TokenConfig = { ...config(), iss: "someone-else" };
    const otherAud: TokenConfig = { ...config(), aud: "someone-else" };
    expect(verifyToken(otherIss, signed, NOW)).toBeNull();
    expect(verifyToken(otherAud, signed, NOW)).toBeNull();
  });

  it("verifies a token signed by a previous key during rotation, but not one dropped from the ring", () => {
    const oldSecret = "old-secret-value";
    const tokenFromOld = signToken(config(oldSecret), principal, "jti_1", NOW);

    // New primary, old kept as previous — the old token still verifies.
    const rotating = config("new-secret-value", [oldSecret]);
    expect(verifyToken(rotating, tokenFromOld, NOW)).toMatchObject({ sub: "usr_1" });

    // Once the old key is dropped, its tokens no longer verify.
    const dropped = config("new-secret-value");
    expect(verifyToken(dropped, tokenFromOld, NOW)).toBeNull();
  });

  it("derives a stable, distinct kid per secret", () => {
    expect(deriveKid("abc")).toBe(deriveKid("abc"));
    expect(deriveKid("abc")).not.toBe(deriveKid("def"));
  });
});
