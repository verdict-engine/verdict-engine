import { Injectable } from "@nestjs/common";
import type { Collection, Store, TxContext } from "../ports/store.port";

class MemoryCollection<T> implements Collection<T> {
  readonly rows = new Map<string, T>();
  async get(id: string): Promise<T | null> {
    return this.rows.get(id) ?? null;
  }
  async put(id: string, value: T): Promise<void> {
    this.rows.set(id, value);
  }
  async putIfAbsent(id: string, value: T): Promise<boolean> {
    if (this.rows.has(id)) return false;
    this.rows.set(id, value);
    return true;
  }
  async delete(id: string): Promise<void> {
    this.rows.delete(id);
  }
  async all(): Promise<T[]> {
    return [...this.rows.values()];
  }
  async prune(tsField: string, cutoff: string): Promise<number> {
    let removed = 0;
    for (const [id, value] of this.rows) {
      const ts = (value as Record<string, unknown>)[tsField];
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
      col = new MemoryCollection<unknown>();
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
