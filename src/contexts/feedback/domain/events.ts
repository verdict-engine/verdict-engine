import type { DomainEvent } from "@shared/domain/domain-event";

/**
 * One label landed on a past event — an analyst resolution or a chargeback. This is
 * the single ground-truth signal the rest of the system learns from: scoring credits
 * the tags that fired, analytics counts it, backtesting replays against it. Emitting it
 * for chargebacks too is what lets the loop see the frauds we allowed, not just the ones
 * we sent to review.
 */
export const LABEL_RECORDED = "label.recorded.v1";

export interface LabelRecordedPayload {
  readonly eventId: string;
  readonly outcome: "fraud" | "legit";
  readonly source: "analyst" | "chargeback";
}

export type LabelRecorded = DomainEvent<LabelRecordedPayload>;
