export interface Collection<T> {
  get(id: string): Promise<T | null>;
  put(id: string, value: T): Promise<void>;
  /** Atomic insert-if-absent: writes only when `id` is new. Returns true if it wrote, false if the
   * id already existed. Used to claim idempotency keys so concurrent duplicates can't both commit. */
  putIfAbsent(id: string, value: T): Promise<boolean>;
  delete(id: string): Promise<void>;
  all(): Promise<T[]>;
  /** Delete every record whose ISO-8601 timestamp at `tsField` is strictly older than `cutoff`, and
   * return how many were removed. Powers the retention prune job that bounds the append-only
   * collections; timestamps are compared lexically, which is chronological for UTC toISOString(). */
  prune(tsField: string, cutoff: string): Promise<number>;
}

/**
 * A set of collections that may be part of an open transaction. Repositories that want to
 * participate in a caller's transaction take an optional `TxContext` and resolve their
 * collection from it instead of the root store — see StoreVerdictLog / StoreOutbox.
 */
export interface TxContext {
  collection<T>(name: string): Collection<T>;
}

/**
 * The persistence seam. A Postgres adapter (production) and an in-memory adapter (dev/tests)
 * implement the same interface, so swapping the store swaps every repository at once.
 *
 * `transaction` runs several collection writes atomically — used by the decision commit so the
 * verdict, activity entry, replay sample and outbox event either all land or none do (the
 * transactional-outbox pattern). Repositories opt in by accepting the `TxContext` it passes.
 */
export interface Store extends TxContext {
  transaction<R>(fn: (tx: TxContext) => Promise<R>): Promise<R>;
  /** Storage stats for disk management — total size on disk and per-collection row counts. */
  stats(): Promise<StoreStats>;
  /** Reclaim dead space left by large deletes (VACUUM on Postgres; a no-op in memory). Non-blocking. */
  reclaim(): Promise<void>;
}

export interface StoreStats {
  /** Total bytes the store occupies on disk (0 when unknown, e.g. in-memory). */
  readonly totalBytes: number;
  readonly collections: ReadonlyArray<{ readonly name: string; readonly rows: number }>;
}

export const STORE = Symbol("Store");
