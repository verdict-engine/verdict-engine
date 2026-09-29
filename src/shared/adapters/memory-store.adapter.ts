import { Injectable } from "@nestjs/common";
import type { Collection, CollectionQuery, Store, StoreStats, TxContext } from "../ports/store.port";
import { stringAt } from "./typed-tables";
import { DEFAULT_ORG, scopeFor } from "./tenant-context";

interface Row<T> {
  readonly org: string;
  readonly value: T;
}

class MemoryCollection<T> implements Collection<T> {
  readonly rows = new Map<string, Row<T>>();

  constructor(private readonly name: string) {}

  /** Rows visible to the caller: all of them for a background/global read, else just the ambient org's. */
  private visible(): Array<[string, Row<T>]> {
    const org = scopeFor(this.name);
    return [...this.rows].filter(([, r]) => org === undefined || r.org === org);
  }

  async get(id: string): Promise<T | null> {
    const org = scopeFor(this.name);
    const row = this.rows.get(id);
    if (!row || (org !== undefined && row.org !== org)) return null;
    return row.value;
  }
  async put(id: string, value: T): Promise<void> {
    this.rows.set(id, { org: scopeFor(this.name) ?? this.rows.get(id)?.org ?? DEFAULT_ORG, value });
  }
  async putIfAbsent(id: string, value: T): Promise<boolean> {
    const org = scopeFor(this.name);
    const existing = this.rows.get(id);
    if (existing && (org === undefined || existing.org === org)) return false;
    this.rows.set(id, { org: org ?? DEFAULT_ORG, value });
    return true;
  }
  async delete(id: string): Promise<void> {
    const org = scopeFor(this.name);
    const row = this.rows.get(id);
    if (row && (org === undefined || row.org === org)) this.rows.delete(id);
  }
  async all(): Promise<T[]> {
    return this.visible().map(([, r]) => r.value);
  }
  async query(spec: CollectionQuery): Promise<T[]> {
    let rows = this.visible().map(([, r]) => r.value);
    const filters = Object.entries(spec.where ?? {});
    if (filters.length) rows = rows.filter((r) => filters.every(([path, v]) => stringAt(r, path) === v));
    if (spec.orderByDesc) {
      const key = spec.orderByDesc;
      rows.sort((a, b) => stringAt(b, key).localeCompare(stringAt(a, key)));
    }
    return spec.limit !== undefined ? rows.slice(0, spec.limit) : rows;
  }
  async deleteWhere(path: string, value: string): Promise<number> {
    let removed = 0;
    for (const [id, r] of this.visible()) {
      if (stringAt(r.value, path) === value) {
        this.rows.delete(id);
        removed++;
      }
    }
    return removed;
  }
  async prune(tsField: string, cutoff: string): Promise<number> {
    let removed = 0;
    for (const [id, r] of this.visible()) {
      const ts = (r.value as Record<string, unknown>)[tsField];
      if (typeof ts === "string" && ts < cutoff) {
        this.rows.delete(id);
        removed++;
      }
    }
    return removed;
  }
}

@Injectable()
export class MemoryStore implements Store {
  private readonly cols = new Map<string, MemoryCollection<unknown>>();
  /** Serializes transactions so concurrent commits don't interleave (see {@link transaction}). */
  private txTail: Promise<unknown> = Promise.resolve();

  collection<T>(name: string): Collection<T> {
    let col = this.cols.get(name);
    if (!col) {
      col = new MemoryCollection<unknown>(name);
      this.cols.set(name, col);
    }
    return col as Collection<T>;
  }

  /**
   * Best-effort atomicity for dev/tests. Transactions are run one at a time (chained off `txTail`):
   * the snapshot/restore below rolls a failed body back, but only serialization keeps two concurrent
   * commits from interleaving their awaits and corrupting a shared collection — which is exactly the
   * isolation a real DB gives via row locks. Not durable (a crash still loses in-memory data) — that
   * is what the Postgres store is for — but it gives the same all-or-nothing, one-at-a-time semantics.
   */
  transaction<R>(fn: (tx: TxContext) => Promise<R>): Promise<R> {
    const run = this.txTail.then(() => this.runExclusive(fn));
    // Keep the chain alive even if this transaction rejects, so the next one still runs.
    this.txTail = run.then(
      () => undefined,
      () => undefined,
    );
    return run;
  }

  async stats(): Promise<StoreStats> {
    let totalBytes = 0;
    const collections: { name: string; rows: number }[] = [];
    for (const [name, col] of this.cols) {
      collections.push({ name, rows: col.rows.size });
      for (const v of col.rows.values()) totalBytes += JSON.stringify(v).length; // rough in-memory estimate
    }
    collections.sort((a, b) => b.rows - a.rows);
    return { totalBytes, collections };
  }

  async reclaim(): Promise<void> {
    // Nothing to reclaim — the in-memory maps drop entries on delete/prune immediately.
  }

  private async runExclusive<R>(fn: (tx: TxContext) => Promise<R>): Promise<R> {
    const snapshot = new Map([...this.cols].map(([name, col]) => [name, new Map(col.rows)]));
    try {
      return await fn(this);
    } catch (cause) {
      for (const [name, col] of this.cols) {
        const saved = snapshot.get(name);
        col.rows.clear();
        if (saved) for (const [k, v] of saved) col.rows.set(k, v);
      }
      throw cause;
    }
  }
}
