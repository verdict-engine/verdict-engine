import { Injectable } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import type { Collection, Store, StoreStats, TxContext } from "../ports/store.port";
import { causeMessage, logEvent } from "../observability/log";
import { runMigrations } from "../migrations/runner";

/** Anything we can run a parameterized query against — the pool, or a client inside a transaction. */
interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<{ data: unknown }>; rowCount?: number | null }>;
}

class PgCollection<T> implements Collection<T> {
  constructor(
    private readonly db: Queryable,
    private readonly name: string,
  ) {}

  async get(id: string): Promise<T | null> {
    const res = await this.db.query("SELECT data FROM documents WHERE collection=$1 AND id=$2", [this.name, id]);
    return (res.rows[0]?.data ?? null) as T | null;
  }

  async put(id: string, value: T): Promise<void> {
    await this.db.query(
      "INSERT INTO documents (collection, id, data) VALUES ($1, $2, $3) ON CONFLICT (collection, id) DO UPDATE SET data = EXCLUDED.data",
      [this.name, id, value],
    );
  }

  async putIfAbsent(id: string, value: T): Promise<boolean> {
    const res = await this.db.query(
      "INSERT INTO documents (collection, id, data) VALUES ($1, $2, $3) ON CONFLICT (collection, id) DO NOTHING",
      [this.name, id, value],
    );
    return res.rowCount === 1;
  }

  async delete(id: string): Promise<void> {
    await this.db.query("DELETE FROM documents WHERE collection=$1 AND id=$2", [this.name, id]);
  }

  async all(): Promise<T[]> {
    const res = await this.db.query("SELECT data FROM documents WHERE collection=$1", [this.name]);
    return res.rows.map((row) => row.data as T);
  }

  async prune(tsField: string, cutoff: string): Promise<number> {
    // `data->>$2 < $3` is a single-statement set delete — bounded by the collection's timestamp
    // index — so the whole collection is never loaded into memory to age it out.
    const res = await this.db.query("DELETE FROM documents WHERE collection=$1 AND data->>$2 < $3", [
      this.name,
      tsField,
      cutoff,
    ]);
    return res.rowCount ?? 0;
  }
}

/** A TxContext whose collections all run on one client inside an open transaction. */
class PgTxContext implements TxContext {
  constructor(private readonly client: PoolClient) {}
  collection<T>(name: string): Collection<T> {
    return new PgCollection<T>(this.client, name);
  }
}

/**
 * PostgreSQL-backed Store — the production persistence adapter. Schema is created by explicit
 * migrations (see migrations/), run once at startup via {@link migrate}, not lazily per query.
 * {@link transaction} runs several writes atomically on a single checked-out client.
 */
@Injectable()
export class PgStore implements Store {
  private readonly pool = new Pool({
    connectionString: process.env.DATABASE_URL,
    // Each decision makes several round-trips, so the default of 10 saturates under load.
    max: Number(process.env.DATABASE_POOL_MAX) || 20,
  });
  private readonly cols = new Map<string, PgCollection<unknown>>();

  /** Apply pending migrations. Called once at startup before the app serves traffic. */
  async migrate(): Promise<string[]> {
    return runMigrations(this.pool);
  }

  collection<T>(name: string): Collection<T> {
    let col = this.cols.get(name);
    if (!col) {
      col = new PgCollection<unknown>(this.pool, name);
      this.cols.set(name, col);
    }
    return col as Collection<T>;
  }

  async transaction<R>(fn: (tx: TxContext) => Promise<R>): Promise<R> {
    const client = await this.pool.connect();
    try {
      await client.query("BEGIN");
      const result = await fn(new PgTxContext(client));
      await client.query("COMMIT");
      return result;
    } catch (cause) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw cause;
    } finally {
      client.release();
    }
  }

  async stats(): Promise<StoreStats> {
    const size = await this.pool.query<{ bytes: string }>("SELECT pg_total_relation_size('documents') AS bytes");
    const rows = await this.pool.query<{ name: string; rows: string }>(
      "SELECT collection AS name, count(*)::bigint AS rows FROM documents GROUP BY collection ORDER BY count(*) DESC",
    );
    return {
      totalBytes: Number(size.rows[0]?.bytes ?? 0),
      collections: rows.rows.map((r) => ({ name: r.name, rows: Number(r.rows) })),
    };
  }

  async reclaim(): Promise<void> {
    // Plain VACUUM (never FULL — that locks the table) returns dead space to the table's freelist for
    // reuse after the retention prune's deletes. Autovacuum also handles this; this makes it prompt.
    // VACUUM cannot run inside a transaction block, so it goes straight to the pool in autocommit.
    try {
      await this.pool.query("VACUUM documents");
    } catch (cause) {
      logEvent("warn", "store.reclaim_failed", { cause: causeMessage(cause) });
    }
  }
}
