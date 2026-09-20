/** A single durable delivery attempt-set: one event to one endpoint, retried until it lands or dies. */
export interface WebhookDeliveryRow {
  readonly id: string;
  readonly endpointId: string;
  /** Event name, e.g. "verdict.reached.v1". */
  readonly event: string;
  /** The exact JSON body to POST (and to sign) — stored so a retry re-sends the identical payload. */
  readonly body: string;
  status: "pending" | "dead";
  attempts: number;
  /** ISO — the relay skips a row until now() >= this (exponential backoff between tries). */
  nextAttemptAt: string;
  lastError?: string;
  readonly createdAt: string;
}

/** Delivery row without the (potentially large) body — for the admin delivery log. */
export interface WebhookDeliveryView {
  id: string;
  endpointId: string;
  event: string;
  status: string;
  attempts: number;
  nextAttemptAt: string;
  lastError?: string;
  createdAt: string;
}

export const WEBHOOK_DELIVERY_COLLECTION = "webhook-deliveries";
export const WEBHOOK_DELIVERY_DLQ_COLLECTION = "webhook-deliveries-dead";

export function summarizeDelivery(r: WebhookDeliveryRow): WebhookDeliveryView {
  return {
    id: r.id,
    endpointId: r.endpointId,
    event: r.event,
    status: r.status,
    attempts: r.attempts,
    nextAttemptAt: r.nextAttemptAt,
    lastError: r.lastError,
    createdAt: r.createdAt,
  };
}
