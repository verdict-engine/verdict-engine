import type { Pool } from "pg";
import { logEvent } from "../observability/log";
import { MIGRATIONS, type Migration } from "./migrations";

const REGISTRY = `CREATE TABLE IF NOT EXISTS schema_migrations (
  id text PRIMARY KEY,
  applied_at timestamptz NOT NULL DEFAULT now()
)`;

/**
 * Applies every migration not yet recorded, in order, each in its own transaction. Idempotent —
 * safe to run on every boot. Advisory-locked so concurrent replicas starting together don't race
 * to apply the same migration.
 */
export async function runMigrations(pool: Pool, migrations: Migration[] = MIGRATIONS): Promise<string[]> {
  const applied: string[] = [];
  const client = await pool.connect();
  try {
    await client.query(REGISTRY);
    // 4711 is an arbitrary, stable lock key for "verdict schema migrations".
    await client.query("SELECT pg_advisory_lock(4711)");
    try {
      const done = new Set<string>(
        (await client.query<{ id: string }>("SELECT id FROM schema_migrations")).rows.map((r) => r.id),
      );
      for (const m of migrations) {
        if (done.has(m.id)) continue;
        await client.query("BEGIN");
        try {
          await client.query(m.up);
          await client.query("INSERT INTO schema_migrations (id) VALUES ($1)", [m.id]);
          await client.query("COMMIT");
          applied.push(m.id);
          logEvent("info", "db.migration.applied", { id: m.id });
        } catch (cause) {
          await client.query("ROLLBACK");
          throw new Error(`migration ${m.id} failed: ${cause instanceof Error ? cause.message : String(cause)}`);
        }
      }
    } finally {
      await client.query("SELECT pg_advisory_unlock(4711)");
    }
  } finally {
    client.release();
  }
  return applied;
}
