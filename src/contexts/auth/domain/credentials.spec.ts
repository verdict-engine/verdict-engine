import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "./credentials";

describe("credentials", () => {
  it("verifies a correct password and rejects a wrong one", () => {
    const hash = hashPassword("supersecret");
    expect(hash).not.toContain("supersecret");
    expect(verifyPassword("supersecret", hash)).toBe(true);
    expect(verifyPassword("wrong", hash)).toBe(false);
  });

  it("produces a different hash each time (salted)", () => {
    expect(hashPassword("pw")).not.toBe(hashPassword("pw"));
  });
});
