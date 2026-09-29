import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { APP_VERSION } from "./version";

/**
 * `APP_VERSION` is the runtime constant (the image doesn't ship package.json, so it can't be imported
 * at runtime). This test makes package.json's version the single source of truth by failing CI if the
 * two ever drift — so a release can't bump one and forget the other.
 */
describe("APP_VERSION", () => {
  it("matches package.json version", () => {
    const pkg = JSON.parse(readFileSync(join(process.cwd(), "package.json"), "utf8")) as { version: string };
    expect(APP_VERSION).toBe(pkg.version);
  });
});
