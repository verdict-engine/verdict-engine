import { Injectable } from "@nestjs/common";
import { Pool, type PoolClient } from "pg";
import type { Collection, CollectionQuery, Store, StoreStats, TxContext } from "../ports/store.port";
import { causeMessage, logEvent } from "../observability/log";
import { runMigrations } from "../migrations/runner";
import {
  TYPED_TABLES,
  TYPED_TABLE_BY_COLLECTION,
  type TypedTableSpec,
  columnValue,
} from "./typed-tables";
import { DEFAULT_ORG, scopeFor } from "./tenant-context";

/** Anything we can run a parameterized query against — the pool, or a client inside a transaction. */
interface Queryable {
  query(text: string, values?: unknown[]): Promise<{ rows: Array<{ data: unknown }>; rowCount?: number | null }>;
}

/** Build the jsonb accessor for a dotted path: `a.b.c` → `data->'a'->'b'->>'c'` (text-typed leaf). */
function jsonbAccessor(path: string): string {
  const parts = path.split(".");
  const leaf = parts[parts.length - 1];
  const head = parts.slice(0, -1).map((p) => `->'${p}'`).join("");
  return `data${head}->>'${leaf}'`;
}

/** Accumulates a parameterized WHERE, so the org predicate composes with the rest by $-index. */
class Where {
  private readonly clauses: string[] = [];
  readonly values: unknown[] = [];
  add(columnExpr: string, value: unknown): void {
    this.values.push(value);
    this.clauses.push(`${columnExpr}=$${this.values.length}`);
  }
  raw(clause: string): void {
    this.clauses.push(clause);
  }
  sql(): string {
    return this.clauses.length ? ` WHERE ${this.clauses.join(" AND ")}` : "";
  }
}

/**
 * Generic collection over the shared `documents` table. Field paths come from repository code (a
 * static set), never request input, so they are safe to interpolate into the jsonb accessor; all
 * record values stay parameterized. Rows are scoped to the ambient org (see tenant-context): request
 * traffic sees only its org, while background work (no ambient org) spans every org.
 */
class PgCollection<T> implements Collection<T> {
  constructor(
    private readonly db: Queryable,
    private readonly name: string,
  ) {}

  /** A WHERE seeded with the collection and, when an org is ambient, the org predicate. */
  private scoped(extra?: (w: Where) => void): Where {
    const w = new Where();
    w.add("collection", this.name);
    const org = scopeFor(this.name);
    if (org !== undefined) w.add("org_id", org);
    extra?.(w);
    return w;
  }

  async get(id: string): Promise<T | null> {
    const w = this.scoped((x) => x.add("id", id));
    const res = await this.db.query(`SELECT data FROM documents${w.sql()}`, w.values);
    return (res.rows[0]?.data ?? null) as T | null;
  }

  async put(id: string, value: T): Promise<void> {
    const org = scopeFor(this.name) ?? DEFAULT_ORG;
    await this.db.query(
      "INSERT INTO documents (collection, org_id, id, data) VALUES ($1, $2, $3, $4) ON CONFLICT (collection, org_id, id) DO UPDATE SET data = EXCLUDED.data",
      [this.name, org, id, value],
    );
  }

  async putIfAbsent(id: string, value: T): Promise<boolean> {
    const org = scopeFor(this.name) ?? DEFAULT_ORG;
    const res = await this.db.query(
      "INSERT INTO documents (collection, org_id, id, data) VALUES ($1, $2, $3, $4) ON CONFLICT (collection, org_id, id) DO NOTHING",
      [this.name, org, id, value],
    );
    return res.rowCount === 1;
  }

  async delete(id: string): Promise<void> {
    const w = this.scoped((x) => x.add("id", id));
    await this.db.query(`DELETE FROM documents${w.sql()}`, w.values);
  }

  async all(): Promise<T[]> {
    const w = this.scoped();
    const res = await this.db.query(`SELECT data FROM documents${w.sql()}`, w.values);
    return res.rows.map((row) => row.data as T);
  }

  async query(spec: CollectionQuery): Promise<T[]> {
    const w = this.scoped((x) => {
      for (const [path, value] of Object.entries(spec.where ?? {})) x.add(jsonbAccessor(path), value);
    });
    const order = spec.orderByDesc ? ` ORDER BY ${jsonbAccessor(spec.orderByDesc)} DESC` : "";
    const limit = spec.limit !== undefined ? ` LIMIT ${Math.floor(spec.limit)}` : "";
    const res = await this.db.query(`SELECT data FROM documents${w.sql()}${order}${limit}`, w.values);
    return res.rows.map((row) => row.data as T);
  }

  async deleteWhere(path: string, value: string): Promise<number> {
    const w = this.scoped((x) => x.add(jsonbAccessor(path), value));
    const res = await this.db.query(`DELETE FROM documents${w.sql()}`, w.values);
    return res.rowCount ?? 0;
  }

  async prune(tsField: string, cutoff: string): Promise<number> {
    // Single-statement set delete bounded by the collection's timestamp index — the whole collection is
    // never loaded into memory. Runs unscoped from the background sweep, so it ages out every org.
    const w = this.scoped((x) => x.raw(`data->>'${tsField}' < $${x.values.push(cutoff)}`));
    const res = await this.db.query(`DELETE FROM documents${w.sql()}`, w.values);
    return res.rowCount ?? 0;
  }
}

/**
 * A collection backed by a dedicated typed table (see typed-tables.ts). Writes the full record as
 * `data jsonb` plus the spec's typed columns; reads/filters/prunes hit those indexed columns. Rows are
 * org-scoped exactly like the generic collection. Table and column names come from the static registry
 * (never request input), so they are safe to interpolate; all record values are parameterized.
 */
class PgTypedCollection<T> implements Collection<T> {
  constructor(
    private readonly db: Queryable,
    private readonly spec: TypedTableSpec,
  ) {}

  private columnFor(path: string): string {
    const col = this.spec.columns.find((c) => c.path === path);
    if (!col) throw new Error(`${this.spec.table}: no typed column for path '${path}'`);
    return col.column;
  }

  /** A WHERE with the org predicate when an org is ambient (typed tables are always org-scoped). */
  private scoped(extra?: (w: Where) => void): Where {
    const w = new Where();
    const org = scopeFor(this.spec.collection);
    if (org !== undefined) w.add("org_id", org);
    extra?.(w);
    return w;
  }

  private insert(id: string, value: T, onConflict: string): { text: string; values: unknown[] } {
    const names = this.spec.columns.map((c) => c.column);
    const columns = ["id", ...names, "org_id", "data"];
    const values: unknown[] = [
      id,
      ...this.spec.columns.map((c) => columnValue(value, c)),
      scopeFor(this.spec.collection) ?? DEFAULT_ORG,
      value,
    ];
    const placeholders = columns.map((_, i) => `$${i + 1}`);
    return {
      text: `INSERT INTO ${this.spec.table} (${columns.join(", ")}) VALUES (${placeholders.join(", ")}) ${onConflict}`,
      values,
    };
  }

  async get(id: string): Promise<T | null> {
    const w = this.scoped((x) => x.add("id", id));
    const res = await this.db.query(`SELECT data FROM ${this.spec.table}${w.sql()}`, w.values);
    return (res.rows[0]?.data ?? null) as T | null;
  }

  async put(id: string, value: T): Promise<void> {
    // Update the typed columns and data on conflict, but never the owning org.
    const set = [...this.spec.columns.map((c) => c.column), "data"].map((c) => `${c}=EXCLUDED.${c}`).join(", ");
    const { text, values } = this.insert(id, value, `ON CONFLICT (id) DO UPDATE SET ${set}`);
    await this.db.query(text, values);
  }

  async putIfAbsent(id: string, value: T): Promise<boolean> {
    const { text, values } = this.insert(id, value, "ON CONFLICT (id) DO NOTHING");
    const res = await this.db.query(text, values);
    return res.rowCount === 1;
  }

  async delete(id: string): Promise<void> {
    const w = this.scoped((x) => x.add("id", id));
    await this.db.query(`DELETE FROM ${this.spec.table}${w.sql()}`, w.values);
  }

  async all(): Promise<T[]> {
    const w = this.scoped();
    const res = await this.db.query(`SELECT data FROM ${this.spec.table}${w.sql()}`, w.values);
    return res.rows.map((row) => row.data as T);
  }

  async query(spec: CollectionQuery): Promise<T[]> {
    const w = this.scoped((x) => {
      for (const [path, value] of Object.entries(spec.where ?? {})) x.add(this.columnFor(path), value);
    });
    const order = spec.orderByDesc ? ` ORDER BY ${this.columnFor(spec.orderByDesc)} DESC` : "";
    const limit = spec.limit !== undefined ? ` LIMIT ${Math.floor(spec.limit)}` : "";
    const res = await this.db.query(`SELECT data FROM ${this.spec.table}${w.sql()}${order}${limit}`, w.values);
    return res.rows.map((row) => row.data as T);
  }

  async deleteWhere(path: string, value: string): Promise<number> {
    const w = this.scoped((x) => x.add(this.columnFor(path), value));
    const res = await this.db.query(`DELETE FROM ${this.spec.table}${w.sql()}`, w.values);
    return res.rowCount ?? 0;
  }

  async prune(tsField: string, cutoff: string): Promise<number> {
    const w = this.scoped((x) => x.raw(`${this.columnFor(tsField)} < $${x.values.push(cutoff)}`));
    const res = await this.db.query(`DELETE FROM ${this.spec.table}${w.sql()}`, w.values);
    return res.rowCount ?? 0;
  }
}

/** Route a collection name to its typed table when one is registered, else the generic documents table. */
function makeCollection<T>(db: Queryable, name: string): Collection<T> {
  const spec = TYPED_TABLE_BY_COLLECTION.get(name);
  return spec ? new PgTypedCollection<T>(db, spec) : new PgCollection<T>(db, name);
}

/** A TxContext whose collections all run on one client inside an open transaction. */
class PgTxContext implements TxContext {
  constructor(private readonly client: PoolClient) {}
  collection<T>(name: string): Collection<T> {
    return makeCollection<T>(this.client, name);
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
  private readonly cols = new Map<string, Collection<unknown>>();

  /** Apply pending migrations. Called once at startup before the app serves traffic. */
  async migrate(): Promise<string[]> {
    return runMigrations(this.pool);
  }

  collection<T>(name: string): Collection<T> {
    let col = this.cols.get(name);
    if (!col) {
      col = makeCollection<unknown>(this.pool, name);
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
      "SELECT collection AS name, count(*)::bigint AS rows FROM documents GROUP BY collection",
    );
    let totalBytes = Number(size.rows[0]?.bytes ?? 0);
    const collections = rows.rows.map((r) => ({ name: r.name, rows: Number(r.rows) }));
    // The high-volume decision logs live in their own typed tables; fold them back into the same
    // reported total and per-collection rows so disk stats and metrics stay whole after the split.
    for (const spec of TYPED_TABLES) {
      const tSize = await this.pool.query<{ bytes: string }>("SELECT pg_total_relation_size($1) AS bytes", [spec.table]);
      const tRows = await this.pool.query<{ rows: string }>(`SELECT count(*)::bigint AS rows FROM ${spec.table}`);
      totalBytes += Number(tSize.rows[0]?.bytes ?? 0);
      collections.push({ name: spec.collection, rows: Number(tRows.rows[0]?.rows ?? 0) });
    }
    collections.sort((a, b) => b.rows - a.rows);
    return { totalBytes, collections };
  }

  async reclaim(): Promise<void> {
    // Plain VACUUM (never FULL — that locks the table) returns dead space to each table's freelist for
    // reuse after the retention prune's deletes. Autovacuum also handles this; this makes it prompt.
    // VACUUM cannot run inside a transaction block, so it goes straight to the pool in autocommit.
    for (const table of ["documents", ...TYPED_TABLES.map((t) => t.table)]) {
      try {
        await this.pool.query(`VACUUM ${table}`);
      } catch (cause) {
        logEvent("warn", "store.reclaim_failed", { table, cause: causeMessage(cause) });
      }
    }
  }
}
