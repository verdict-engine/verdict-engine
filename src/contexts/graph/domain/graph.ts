import type { RiskEvent } from "@contexts/ingest/application/ingest.port";

/**
 * The graph links the identifiers one event carries — who, on what device, from what IP —
 * so a ring that no single event reveals becomes visible as a connected cluster. Cards are
 * deliberately not nodes: we hold only the issuer BIN, which is shared by millions and would
 * over-link. New node kinds are additive.
 */
export type EntityKind = "user" | "device" | "ip" | "phone";

export interface EntityRef {
  readonly kind: EntityKind;
  readonly id: string;
}

/** A node's adjacency — the distinct entities it has co-occurred with, as sorted keys. */
export interface NodeRecord {
  readonly neighbors: string[];
}

export const nodeKey = (kind: EntityKind, id: string): string => `${kind}:${id}`;

export function refOfKey(key: string): EntityRef {
  const i = key.indexOf(":");
  return { kind: key.slice(0, i) as EntityKind, id: key.slice(i + 1) };
}

/** The entities an event ties together — always a user, plus a device and/or IP when present. */
export function entitiesOf(event: RiskEvent): EntityRef[] {
  const refs: EntityRef[] = [{ kind: "user", id: event.subject.userId }];
  if (event.subject.deviceId) refs.push({ kind: "device", id: event.subject.deviceId });
  if (event.subject.ip) refs.push({ kind: "ip", id: event.subject.ip });
  if (event.subject.phone) refs.push({ kind: "phone", id: event.subject.phone });
  return refs;
}

/** Every unordered pair among the refs — the edges this event asserts. */
export function edgesOf(refs: readonly EntityRef[]): Array<[string, string]> {
  const keys = refs.map((r) => nodeKey(r.kind, r.id));
  const pairs: Array<[string, string]> = [];
  for (let i = 0; i < keys.length; i++) {
    for (let j = i + 1; j < keys.length; j++) pairs.push([keys[i], keys[j]]);
  }
  return pairs;
}

export function withNeighbor(node: NodeRecord | null, neighbor: string): NodeRecord {
  const set = new Set(node?.neighbors ?? []);
  set.add(neighbor);
  return { neighbors: [...set].sort() };
}

export const neighborsOfKind = (node: NodeRecord | null, kind: EntityKind): string[] =>
  (node?.neighbors ?? []).filter((k) => k.startsWith(`${kind}:`));
