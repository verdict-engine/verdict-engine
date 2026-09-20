import { describe, expect, it } from "vitest";
import { InMemoryRateLimiter } from "./in-memory-rate-limiter.adapter";

describe("InMemoryRateLimiter", () => {
  it("allows up to the limit, then denies with a retry-after", async () => {
    const rl = new InMemoryRateLimiter();
    expect((await rl.take("k", 2, 60_000)).allowed).toBe(true);
    expect((await rl.take("k", 2, 60_000)).allowed).toBe(true);
    const denied = await rl.take("k", 2, 60_000);
    expect(denied.allowed).toBe(false);
    expect(denied.retryAfterMs).toBeGreaterThan(0);
    expect(denied.remaining).toBe(0);
  });

  it("keeps a separate budget per key", async () => {
    const rl = new InMemoryRateLimiter();
    await rl.take("a", 1, 60_000);
    expect((await rl.take("b", 1, 60_000)).allowed).toBe(true);
  });

  it("reports the remaining budget", async () => {
    const rl = new InMemoryRateLimiter();
    expect((await rl.take("k", 3, 60_000)).remaining).toBe(2);
  });

  it("starts a fresh window once the old one elapses", async () => {
    const rl = new InMemoryRateLimiter();
    expect((await rl.take("k", 1, -1)).allowed).toBe(true); // already-expired window
    expect((await rl.take("k", 1, -1)).allowed).toBe(true);
  });
});
