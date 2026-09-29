import type { RiskEvent } from "@contexts/ingest/application/ingest.port";

export type ListKind = "block" | "allow" | "watch";
export type ListSubject = "user" | "device" | "ip" | "bin";

export interface ListEntry {
  readonly kind: ListKind;
  readonly subject: ListSubject;
  readonly value: string;
  readonly reason?: string;
  /** The owning tenant, stored so boot hydration (which reads all orgs) can bucket entries by org. */
  readonly orgId?: string;
}

/** Outcome of consulting the lists — precedence: block > allow > watch. */
export interface ListMatch {
  readonly decision: "deny" | "allow" | "watch" | "none";
  readonly reason?: string;
}

/**
 * Hard block/allow/watch lists checked BEFORE scoring: block denies, allow bypasses
 * scoring, watch forces at least review. A separate context so list management never entangles scoring.
 */
export interface ListsPort {
  check(event: RiskEvent): Promise<ListMatch>;
  add(entry: ListEntry): Promise<void>;
}

export const LISTS_PORT = Symbol("ListsPort");
