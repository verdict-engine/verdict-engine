import { beforeEach, describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store.adapter";
import { RateLimitConfigError, RateLimitSettings } from "./rate-limit-settings";

describe("RateLimitSettings", () => {
  let settings: RateLimitSettings;

  beforeEach(() => {
    settings = new RateLimitSettings(new MemoryStore());
  });

  it("falls back to env/LIMITS defaults when nothing is overridden", async () => {
    const snap = await settings.snapshot();
    expect(snap.decisionsPerMin).toBe(600);
    expect(snap.loginPerMin).toBe(10);
    expect(snap.overridden).toEqual({ decisionsPerMin: false, loginPerMin: false });
  });

  it("applies an override and resolves it per name", async () => {
    await settings.update({ decisionsPerMin: 50 });
    expect((await settings.resolve("decisions")).limit).toBe(50);
    expect((await settings.resolve("login")).limit).toBe(10); // untouched
    const snap = await settings.snapshot();
    expect(snap.decisionsPerMin).toBe(50);
    expect(snap.overridden.decisionsPerMin).toBe(true);
  });

  it("reverts an override to the default when set to null", async () => {
    await settings.update({ decisionsPerMin: 50 });
    await settings.update({ decisionsPerMin: null });
    const snap = await settings.snapshot();
    expect(snap.decisionsPerMin).toBe(600);
    expect(snap.overridden.decisionsPerMin).toBe(false);
  });

  it("rejects invalid values", async () => {
    await expect(settings.update({ loginPerMin: 0 })).rejects.toBeInstanceOf(RateLimitConfigError);
    await expect(settings.update({ loginPerMin: 1.5 })).rejects.toBeInstanceOf(RateLimitConfigError);
  });
});
