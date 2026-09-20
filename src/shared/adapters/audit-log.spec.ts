import { beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "../ports/clock.port";
import { MonotonicIdGenerator } from "./monotonic-id-generator.adapter";
import { MemoryStore } from "./memory-store.adapter";
import { redactBody } from "../domain/audit";
import { AuditLog } from "./audit-log";

describe("redactBody", () => {
  it("redacts secret-ish keys and keeps the rest", () => {
    const out = redactBody({
      url: "https://hooks.slack.com/services/T/B/secret",
      password: "hunter2",
      token: "abc",
      decisionsPerMin: 1200,
      nested: { apiKey: "k", note: "keep" },
    }) as Record<string, unknown>;

    expect(out.url).toBe("[redacted]");
    expect(out.password).toBe("[redacted]");
    expect(out.token).toBe("[redacted]");
    expect(out.decisionsPerMin).toBe(1200);
    expect((out.nested as Record<string, unknown>).apiKey).toBe("[redacted]");
    expect((out.nested as Record<string, unknown>).note).toBe("keep");
  });

  it("caps very long strings", () => {
    const out = redactBody({ name: "x".repeat(1000) }) as Record<string, string>;
    expect(out.name.endsWith("…")).toBe(true);
    expect(out.name.length).toBeLessThan(1000);
  });
});

describe("AuditLog", () => {
  let store: MemoryStore;
  let clock: Clock;
  let log: AuditLog;
  let t: number;

  beforeEach(() => {
    store = new MemoryStore();
    t = new Date("2026-01-01T00:00:00.000Z").getTime();
    clock = { now: () => new Date(t), isoNow: () => new Date(t).toISOString() };
    log = new AuditLog(store, clock, new MonotonicIdGenerator());
  });

  it("records entries and returns them newest-first with a total", async () => {
    for (let i = 0; i < 3; i++) {
      await log.record({ actor: "admin@x", role: "admin", action: `PUT /v1/config/rate-limits#${i}`, status: 200 });
      t += 1000;
    }
    const page = await log.list(10);
    expect(page.total).toBe(3);
    expect(page.entries[0].action).toContain("#2"); // newest first
    expect(page.entries[2].action).toContain("#0");
  });

  it("paginates", async () => {
    for (let i = 0; i < 5; i++) {
      await log.record({ actor: "a", action: `x#${i}`, status: 200 });
      t += 1000;
    }
    const page = await log.list(2, 2);
    expect(page.total).toBe(5);
    expect(page.entries).toHaveLength(2);
    expect(page.entries[0].action).toBe("x#2");
  });
});
