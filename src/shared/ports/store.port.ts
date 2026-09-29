/**
 * A pushed-down read over a collection: equality filters, one descending sort, and a row cap.
 * On Postgres these run as an indexed query; the in-memory store scans its own map. Keys and the
 * sort field are dotted paths into the record (e.g. `request.subject.userId`), which the typed-table
 * store maps to real columns. Lets hot read paths bound their work instead of loading a whole
 * collection into memory to sort and slice it.
 */
export interface CollectionQuery {
  /** Equality filters, ANDed together: dotted-path field → required string value. */
  readonly where?: Readonly<Record<string, string>>;
  /** Dotted path of the field to order by, descending (typically a timestamp). */
  readonly orderByDesc?: string;
  readonly limit?: number;
}

export interface Collection<T> {
  get(id: string): Promise<T | null>;
  put(id: string, value: T): Promise<void>;
  /** Atomic insert-if-absent: writes only when `id` is new. Returns true if it wrote, false if the
   * id already existed. Used to claim idempotency keys so concurrent duplicates can't both commit. */
  putIfAbsent(id: string, value: T): Promise<boolean>;
  delete(id: string): Promise<void>;
  all(): Promise<T[]>;
  /** Indexed, filtered, limited read — the query pushdown that keeps hot paths (recent decisions,
   * replay samples for a type) from loading and sorting an entire collection in memory. */
  query(spec: CollectionQuery): Promise<T[]>;
  /** Delete every record whose dotted-path field equals `value`; returns the count removed. Backs
   * subject data-erasure without scanning the collection into memory first. */
  deleteWhere(path: string, value: string): Promise<number>;
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
