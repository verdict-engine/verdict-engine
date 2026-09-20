import { beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "@shared/ports/clock.port";
import { MemoryStore } from "@shared/adapters/memory-store.adapter";
import { PruneService } from "./prune.service";
import { RetentionSettings } from "./retention-settings";

const DAY = 24 * 60 * 60 * 1000;
const base = new Date("2026-06-01T00:00:00.000Z").getTime();
const at = (dayOffset: number): string => new Date(base + dayOffset * DAY).toISOString();

describe("PruneService", () => {
  let store: MemoryStore;
  let clock: Clock;
  let settings: RetentionSettings;
  let prune: PruneService;

  beforeEach(() => {
    store = new MemoryStore();
    // "now" is day 400 — old enough that the default windows (365/90/7/30 days) all bite.
    const now = new Date(base + 400 * DAY);
    clock = { now: () => now, isoNow: () => now.toISOString() };
    settings = new RetentionSettings(store);
    prune = new PruneService(store, clock, settings);
  });

  const seed = (collection: string, id: string, tsField: string, day: number) =>
    store.collection<Record<string, string>>(collection).put(id, { [tsField]: at(day) });

  it("prunes rows older than the window and keeps recent ones", async () => {
    await seed("idempotency", "old", "claimedAt", 300); // 100 days ago > 7-day window
    await seed("idempotency", "recent", "claimedAt", 399); // 1 day ago
    await seed("activity", "old", "decidedAt", 250); // 150 days ago > 90-day window
    await seed("activity", "recent", "decidedAt", 350); // 50 days ago

    const report = await prune.sweep();

    expect(report.pruned.idempotency).toBe(1);
    expect(report.pruned.activity).toBe(1);
    expect(await store.collection("idempotency").all()).toHaveLength(1);
    expect(await store.collection("activity").all()).toHaveLength(1);
    expect((await store.collection<Record<string, string>>("idempotency").get("recent"))).not.toBeNull();
  });

  it("keeps a collection forever when its window is 0", async () => {
    await settings.update({ verdicts: 0 });
    await seed("verdicts", "ancient", "decidedAt", 0); // 400 days ago

    const report = await prune.sweep();

    expect(report.pruned.verdicts).toBeUndefined(); // skipped, not pruned
    expect(await store.collection("verdicts").all()).toHaveLength(1);
  });

  it("respects a runtime override that shortens a window", async () => {
    await seed("activity", "d50", "decidedAt", 350); // 50 days ago — kept under the 90-day default

    expect((await prune.sweep()).pruned.activity).toBe(0);

    await settings.update({ activity: 30 }); // now anything older than 30 days goes
    expect((await prune.sweep()).pruned.activity).toBe(1);
    expect(await store.collection("activity").all()).toHaveLength(0);
  });

  it("ages out dead-lettered outbox rows by createdAt", async () => {
    await seed("outbox_dead", "old", "createdAt", 300); // 100 days ago > 30-day window
    await seed("outbox_dead", "recent", "createdAt", 380); // 20 days ago

    const report = await prune.sweep();

    expect(report.pruned.deadLetter).toBe(1);
    expect(await store.collection("outbox_dead").all()).toHaveLength(1);
  });

  it("leaves rows without the timestamp field untouched", async () => {
    await store.collection<{ note: string }>("idempotency").put("malformed", { note: "no claimedAt" });

    const report = await prune.sweep();

    expect(report.pruned.idempotency).toBe(0);
    expect(await store.collection("idempotency").all()).toHaveLength(1);
  });
});
