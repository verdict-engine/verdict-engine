import type { RiskEvent } from "@contexts/ingest/application/ingest.port";

/**
 * FeatureSnapshot — the derived, point-in-time view Rules and Scoring read.
 * Computed at write time so the request-path read is a single sub-millisecond lookup.
 */
export interface FeatureSnapshot {
  readonly velocity: {
    readonly attemptsLast2m: number;
    readonly attemptsLast24h: number;
    readonly amountLast1h: number;
  };
  readonly device: {
    readonly firstSeen: boolean;
    readonly usersOnDevice: number;
  };
  readonly geo: {
    readonly ipSimMismatch: boolean;
  };
  /** Entity-graph signals, merged in by the decision orchestrator (the graph context owns them). */
  readonly graph?: {
    readonly usersOnDevice: number;
    readonly usersOnIp: number;
    readonly usersOnPhone: number;
    readonly devicesOnUser: number;
    readonly ringSize: number;
  };
  /** Outlier signals, merged in by the decision orchestrator (the anomaly context owns them). */
  readonly anomaly?: {
    readonly amountZScore: number;
    readonly amountMean: number;
    readonly samples: number;
  };
}

/**
 * FeatureStorePort — outbound port owned by the Feature Store context; the default
 * adapter is Redis, but the interface says nothing about that.
 */
export interface FeatureStorePort {
  record(event: RiskEvent): Promise<void>;
  snapshot(event: RiskEvent): Promise<FeatureSnapshot>;
}

export const FEATURE_STORE_PORT = Symbol("FeatureStorePort");
