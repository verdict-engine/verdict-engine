import type { DomainEvent } from "@shared/domain/domain-event";
import type { Decision, Verdict } from "./verdict";

/**
 * The one fact the Decision context broadcasts. A stable name is a contract —
 * new consumers (Cases on `review`, analytics on all) attach without Decision knowing.
 */
export const VERDICT_REACHED = "verdict.reached.v1";

export interface VerdictReachedPayload {
  readonly verdictId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly verdict: Verdict;
  readonly score: number;
  readonly reasons: ReadonlyArray<{ tag: string; points: number }>;
  readonly reviewQueue?: string;
}

export type VerdictReached = DomainEvent<VerdictReachedPayload>;

export const toVerdictReachedPayload = (
  d: Decision,
  eventType: string,
  reviewQueue?: string,
): VerdictReachedPayload => ({
  verdictId: d.id,
  eventId: d.eventId,
  eventType,
  verdict: d.verdict,
  score: d.score,
  reasons: d.reasons,
  reviewQueue,
});
