/**
 * Which logical collections are backed by dedicated, typed physical tables instead of the shared
 * generic `documents(collection, id, data jsonb)` table. These are the high-volume, append-only
 * decision logs whose hot reads (recent decisions, replay samples for a type, subject erasure) would
 * otherwise scan a whole collection: giving them real indexed columns turns those reads into indexed
 * SQL. The registry is pure data — the Postgres store consults it to route reads/writes, the schema
 * is created by an explicit migration, and field values are extracted generically by dotted path, so
 * no per-entity code lives here. The full record is still stored as `data jsonb`, so the typed
 * columns are a query surface, not a second source of truth, and adding a field stays additive.
 */
export type ColumnType = "text" | "timestamptz" | "double precision";

export interface TypedColumn {
  /** Physical SQL column name. */
  readonly column: string;
  /** Dotted path into the record whose value this column mirrors (e.g. `request.subject.userId`). */
  readonly path: string;
  readonly type: ColumnType;
}

export interface TypedTableSpec {
  /** Logical collection name the repositories address — unchanged by the physical split. */
  readonly collection: string;
  /** Physical table name. */
  readonly table: string;
  /** Columns extracted from each record for indexing/filtering; `id` and `data` are implicit. */
  readonly columns: readonly TypedColumn[];
}

export const TYPED_TABLES: readonly TypedTableSpec[] = [
  {
    collection: "verdicts",
    table: "verdict_log",
    columns: [
      { column: "decided_at", path: "decidedAt", type: "timestamptz" },
      { column: "verdict", path: "verdict", type: "text" },
      { column: "event_id", path: "eventId", type: "text" },
    ],
  },
  {
    collection: "activity",
    table: "activity_log",
    columns: [
      { column: "decided_at", path: "decidedAt", type: "timestamptz" },
      { column: "subject_user_id", path: "request.subject.userId", type: "text" },
      { column: "event_type", path: "eventType", type: "text" },
    ],
  },
  {
    collection: "replay-samples",
    table: "replay_log",
    columns: [
      { column: "decided_at", path: "decidedAt", type: "timestamptz" },
      { column: "event_type", path: "eventType", type: "text" },
      { column: "subject_user_id", path: "event.subject.userId", type: "text" },
    ],
  },
];

export const TYPED_TABLE_BY_COLLECTION: ReadonlyMap<string, TypedTableSpec> = new Map(
  TYPED_TABLES.map((t) => [t.collection, t]),
);

/** Read a dotted path out of a record, returning `undefined` if any segment is missing. */
export function getPath(record: unknown, path: string): unknown {
  let current: unknown = record;
  for (const key of path.split(".")) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[key];
  }
  return current;
}

/** The path's value as the string used for equality/sort in the in-memory store (absent → ""). */
export function stringAt(record: unknown, path: string): string {
  const value = getPath(record, path);
  return value === undefined || value === null ? "" : String(value);
}

/** Coerce a record's field to the bind value for its typed column (null when absent). */
export function columnValue(record: unknown, column: TypedColumn): string | number | null {
  const value = getPath(record, column.path);
  if (value === undefined || value === null) return null;
  if (column.type === "double precision") return typeof value === "number" ? value : Number(value);
  // text and timestamptz both bind as strings — Postgres casts an ISO-8601 string to timestamptz.
  return String(value);
}
