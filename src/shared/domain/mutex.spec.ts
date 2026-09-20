import { describe, expect, it } from "vitest";
import { Mutex } from "./mutex";

const tick = () => new Promise((r) => setTimeout(r, 0));

describe("Mutex", () => {
  it("serializes async read-modify-write so no update is lost", async () => {
    let shared = 0;
    const increment = async () => {
      const seen = shared;
      await tick(); // the load→save gap a real async store has
      shared = seen + 1;
    };

    // Without serialization, concurrent folds read the same value and clobber each other.
    shared = 0;
    await Promise.all(Array.from({ length: 50 }, increment));
    expect(shared).toBeLessThan(50);

    // Through the mutex, every fold lands.
    shared = 0;
    const lock = new Mutex();
    await Promise.all(Array.from({ length: 50 }, () => lock.run(increment)));
    expect(shared).toBe(50);
  });

  it("keeps running after a section throws", async () => {
    const lock = new Mutex();
    await expect(lock.run(async () => { throw new Error("boom"); })).rejects.toThrow("boom");
    await expect(lock.run(async () => 42)).resolves.toBe(42);
  });
});
