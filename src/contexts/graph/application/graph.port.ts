import type { RiskEvent } from "@contexts/ingest/application/ingest.port";
import type { EntityKind } from "../domain/graph";

/** Graph-derived signals rules can read as `graph.*`. Structurally matches FeatureSnapshot.graph. */
export interface GraphFeatures {
  readonly usersOnDevice: number;
  readonly usersOnIp: number;
  readonly usersOnPhone: number;
  readonly devicesOnUser: number;
  /** Size of the connected cluster this event's user sits in — the ring signal. */
  readonly ringSize: number;
}

export interface Neighborhood {
  readonly kind: EntityKind;
  readonly id: string;
  readonly users: string[];
  readonly devices: string[];
  readonly ips: string[];
  readonly phones: string[];
  readonly ringSize: number;
}

/**
 * A synchronous feature source, like the velocity store: `featuresFor` is read on the
 * decision path (before rules), `observe` records the event's links after. `neighborhood`
 * is the analyst-facing read for inspecting a ring.
 */
export interface GraphPort {
  featuresFor(event: RiskEvent): Promise<GraphFeatures>;
  observe(event: RiskEvent): Promise<void>;
  neighborhood(kind: EntityKind, id: string): Promise<Neighborhood>;
  /** Remove an entity from the graph and unlink it from its neighbors (data erasure). */
  erase(kind: EntityKind, id: string): Promise<void>;
}

export const GRAPH_PORT = Symbol("GraphPort");
