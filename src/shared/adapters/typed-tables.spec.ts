import { describe, expect, it } from "vitest";
import { MemoryStore } from "./memory-store.adapter";
import { columnValue, getPath, stringAt, type TypedColumn } from "./typed-tables";

describe("typed-table field extraction", () => {
  const record = { decidedAt: "2026-01-02T00:00:00.000Z", score: 42, request: { subject: { userId: "u1" } } };

  it("reads nested dotted paths and reports absent segments as undefined/empty", () => {
    expect(getPath(record, "request.subject.userId")).toBe("u1");
    expect(getPath(record, "request.subject.missing")).toBeUndefined();
    expect(getPath(record, "a.b.c")).toBeUndefined();
    expect(stringAt(record, "request.subject.userId")).toBe("u1");
    expect(stringAt(record, "request.subject.missing")).toBe("");
  });

  it("coerces each column to its bind type, and absent fields to null", () => {
    const ts: TypedColumn = { column: "decided_at", path: "decidedAt", type: "timestamptz" };
    const num: TypedColumn = { column: "score", path: "score", type: "double precision" };
    const text: TypedColumn = { column: "uid", path: "request.subject.userId", type: "text" };
    const absent: TypedColumn = { column: "x", path: "nope", type: "text" };
    expect(columnValue(record, ts)).toBe("2026-01-02T00:00:00.000Z");
    expect(columnValue(record, num)).toBe(42);
    expect(columnValue(record, text)).toBe("u1");
    expect(columnValue(record, absent)).toBeNull();
  });
});

describe("collection query pushdown (memory store parity)", () => {
  interface Row {
    readonly id: string;
    readonly eventType: string;
    readonly decidedAt: string;
    readonly event: { subject: { userId: string } };
  }
  const row = (id: string, eventType: string, day: number, userId: string): Row => ({
    id,
    eventType,
    decidedAt: `2026-01-${String(day).padStart(2, "0")}T00:00:00.000Z`,
    event: { subject: { userId } },
  });

  const seed = async (): Promise<MemoryStore> => {
    const store = new MemoryStore();
    const col = store.collection<Row>("replay-samples");
    await col.put("a", row("a", "card.authorize", 1, "u1"));
    await col.put("b", row("b", "card.authorize", 3, "u2"));
    await col.put("c", row("c", "login", 4, "u1"));
    await col.put("d", row("d", "card.authorize", 2, "u1"));
    return store;
  };

  it("filters by field, orders descending, and applies the limit", async () => {
    const store = await seed();
    const result = await store
      .collection<Row>("replay-samples")
      .query({ where: { eventType: "card.authorize" }, orderByDesc: "decidedAt", limit: 2 });
    expect(result.map((r) => r.id)).toEqual(["b", "d"]); // day 3 then day 2, "a" (day 1) cut by limit
  });

  it("orders newest-first with no filter", async () => {
    const store = await seed();
    const result = await store.collection<Row>("replay-samples").query({ orderByDesc: "decidedAt" });
    expect(result.map((r) => r.id)).toEqual(["c", "b", "d", "a"]);
  });

  it("deletes every row matching a nested path and returns the count", async () => {
    const store = await seed();
    const col = store.collection<Row>("replay-samples");
    const removed = await col.deleteWhere("event.subject.userId", "u1");
    expect(removed).toBe(3);
    expect((await col.all()).map((r) => r.id)).toEqual(["b"]);
  });
});
