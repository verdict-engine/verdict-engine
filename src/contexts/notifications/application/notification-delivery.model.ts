/** A single durable alert delivery: one event to one channel, retried until it lands or dies. */
export interface NotificationDeliveryRow {
  readonly id: string;
  readonly channelId: string;
  /** Event name, e.g. "alert.anomaly.v1". */
  readonly event: string;
  /** The exact body to POST — stored so a retry re-sends the identical payload. */
  readonly body: string;
  status: "pending" | "dead";
  attempts: number;
  /** ISO — the relay skips a row until now() >= this (exponential backoff between tries). */
  nextAttemptAt: string;
  lastError?: string;
  readonly createdAt: string;
}

/** Delivery row without the body — for the admin delivery log. */
export interface NotificationDeliveryView {
  id: string;
  channelId: string;
  event: string;
  status: string;
  attempts: number;
  nextAttemptAt: string;
  lastError?: string;
  createdAt: string;
}

export const NOTIFICATION_DELIVERY_COLLECTION = "notification-deliveries";
export const NOTIFICATION_DELIVERY_DLQ_COLLECTION = "notification-deliveries-dead";

export function summarizeDelivery(r: NotificationDeliveryRow): NotificationDeliveryView {
  return {
    id: r.id,
    channelId: r.channelId,
    event: r.event,
    status: r.status,
    attempts: r.attempts,
    nextAttemptAt: r.nextAttemptAt,
    lastError: r.lastError,
    createdAt: r.createdAt,
  };
}
