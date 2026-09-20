import { Injectable } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import type { Collection, Store, TxContext } from "../ports/store.port";
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
}
