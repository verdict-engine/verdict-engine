import { describe, expect, it, vi } from "vitest";
import type { Pool } from "pg";
import { runMigrations } from "./runner";
import type { Migration } from "./migrations";

/** A fake pool/client that records applied migration ids in an in-memory "schema_migrations". */
function fakePool(): { pool: Pool; applied: Set<string> } {
  const applied = new Set<string>();
  const query = vi.fn(async (text: string, values?: unknown[]) => {
    if (text.startsWith("SELECT id FROM schema_migrations")) {
      return { rows: [...applied].map((id) => ({ id })) };
    }
    if (text.startsWith("INSERT INTO schema_migrations")) {
      applied.add((values as string[])[0]);
      return { rows: [] };
    }
    return { rows: [] };
  });
  const client = { query, release: vi.fn() };
  const pool = { connect: vi.fn(async () => client) } as unknown as Pool;
  return { pool, applied };
}

const migs: Migration[] = [
  { id: "001_a", up: "CREATE TABLE a()", down: "DROP TABLE a" },
  { id: "002_b", up: "CREATE TABLE b()", down: "DROP TABLE b" },
];

describe("runMigrations", () => {
  it("applies all pending migrations in order and records them", async () => {
    const { pool, applied } = fakePool();
    const first = await runMigrations(pool, migs);
    expect(first).toEqual(["001_a", "002_b"]);
    expect(applied.has("001_a") && applied.has("002_b")).toBe(true);
  });

  it("is idempotent — a second run applies nothing", async () => {
    const { pool } = fakePool();
    await runMigrations(pool, migs);
    const second = await runMigrations(pool, migs);
    expect(second).toEqual([]);
  });

  it("only applies migrations not already recorded", async () => {
    const { pool, applied } = fakePool();
    applied.add("001_a");
    const result = await runMigrations(pool, migs);
    expect(result).toEqual(["002_b"]);
  });
});
