import type { FeatureSnapshot } from "@contexts/feature-store/application/feature-store.port";
import type { RiskEvent } from "@contexts/ingest/application/ingest.port";
import type { TxContext } from "@shared/ports/store.port";
import type { Verdict } from "../domain/verdict";

/**
 * The inputs a decision was made from, kept so a rule or policy change can be replayed
 * against real history — the append-only verdict log records the outcome, this records
 * the cause. Only decisions where rules actually ran are sampled (list hits and degraded
 * fallbacks have nothing to replay).
 */
export interface ReplaySample {
  readonly eventId: string;
  readonly eventType: string;
  readonly event: RiskEvent;
  readonly features: FeatureSnapshot;
  readonly verdict: Verdict;
  readonly score: number;
  readonly decidedAt: string;
}

export interface ReplayLogPort {
  record(sample: ReplaySample, tx?: TxContext): Promise<void>;
  samplesFor(eventType: string, limit: number): Promise<ReplaySample[]>;
  /** Delete every stored sample belonging to a user (data erasure); returns the count removed. */
  eraseSubject(userId: string): Promise<number>;
}

export const REPLAY_LOG_PORT = Symbol("ReplayLogPort");
