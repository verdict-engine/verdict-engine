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
    /** Fingerprint signals — device identity independent of a client-supplied deviceId. */
    readonly fingerprintFirstSeen: boolean;
    readonly usersOnFingerprint: number;
    /** The fingerprint has been seen paired with a different deviceId (a cloned/spoofed device). */
    readonly fingerprintDeviceMismatch: boolean;
  };
  readonly geo: {
    readonly ipSimMismatch: boolean;
    /** ISO country resolved from the IP, if resolvable. */
    readonly country?: string;
    /** Kilometres from the user's previous location, if known. */
    readonly distanceKm?: number;
    /** The move from the last event is faster than a jet — the same person can't be in both places. */
    readonly impossibleTravel: boolean;
    /** The resolved country differs from the user's previous one. */
    readonly countryChanged: boolean;
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
