import { randomUUID } from "node:crypto";
import type { DomainEvent } from "./domain-event";

/**
 * An operational alert broadcast on the bus when something needs an operator's attention — a
 * delivery that exhausted its retries. It carries no customer data, just what failed and why, so
 * it's safe to fan out to Slack. Notifications subscribe to it; nothing else does (no loop).
 */
export const ALERT_DEAD_LETTER = "alert.dead_letter.v1";

export interface DeadLetterAlertPayload {
  readonly source: "outbox" | "webhook" | "notification";
  /** The dead-lettered item's id (event id or delivery id). */
  readonly ref: string;
  /** The underlying event name. */
  readonly name: string;
  readonly attempts: number;
  readonly error: string;
}

export function deadLetterAlert(payload: DeadLetterAlertPayload, occurredAt: string, correlationId = "system"): DomainEvent<DeadLetterAlertPayload> {
  return { name: ALERT_DEAD_LETTER, id: randomUUID(), occurredAt, correlationId, payload };
}

/**
 * Fired when a decision's amount z-score crosses the configured threshold — the spend is far from
 * this user's own history. Carries only ids and the score, so it's safe to fan out to Slack.
 */
export const ALERT_ANOMALY = "alert.anomaly.v1";

export interface AnomalyAlertPayload {
  readonly userId: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly amountZScore: number;
  readonly amount?: number;
  readonly currency?: string;
  readonly verdict: string;
}
