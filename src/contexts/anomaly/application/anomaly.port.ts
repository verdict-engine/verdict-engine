import type { RiskEvent } from "@contexts/ingest/application/ingest.port";

/** Outlier signals rules read as `anomaly.*`. Structurally matches FeatureSnapshot.anomaly. */
export interface AnomalyFeatures {
  /** Standard deviations the event's amount sits from this user's own history; 0 if unknown. */
  readonly amountZScore: number;
  readonly amountMean: number;
  readonly samples: number;
}

/**
 * A synchronous feature source, like the velocity store and the graph: `featuresFor` is
 * read on the decision path (before rules), `observe` folds the event into the baseline after.
 */
export interface AnomalyPort {
  featuresFor(event: RiskEvent): Promise<AnomalyFeatures>;
  observe(event: RiskEvent): Promise<void>;
  /** Drop a user's learned baseline (data erasure). */
  erase(userId: string): Promise<void>;
}

export const ANOMALY_PORT = Symbol("AnomalyPort");
