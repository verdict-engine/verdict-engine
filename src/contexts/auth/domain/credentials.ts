import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";

/**
 * Password hashing with Node's built-in scrypt — no external dependency, and the
 * salt is stored alongside the derived key as `salt:hash`. Comparison is
 * constant-time. Plaintext passwords never leave this function.
 */
export function hashPassword(password: string): string {
  const salt = randomBytes(16);
  const derived = scryptSync(password, salt, 64);
  return `${salt.toString("hex")}:${derived.toString("hex")}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(":");
  if (!saltHex || !hashHex) return false;
  const derived = scryptSync(password, Buffer.from(saltHex, "hex"), 64);
  const target = Buffer.from(hashHex, "hex");
  return derived.length === target.length && timingSafeEqual(derived, target);
}
