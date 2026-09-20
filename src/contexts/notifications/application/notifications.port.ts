import type { ChannelType, ChannelView, NotifyEvent } from "../domain/notification";
import type { NotificationDeliveryView } from "./notification-delivery.model";

export interface RegisterChannelInput {
  type: ChannelType;
  url: string;
  /** Telegram chat id — required for the telegram type, ignored otherwise. */
  target?: string;
  events: NotifyEvent[];
  minVerdict?: string;
  /** Per-minute cap for this channel (0 = unlimited); omitted uses the env default. */
  throttlePerMin?: number;
  createdBy: string;
}

export interface NotificationsPort {
  register(input: RegisterChannelInput): Promise<ChannelView>;
  list(): Promise<ChannelView[]>;
  revoke(id: string): Promise<void>;
  /** Send a sample message to one channel so an operator can confirm it's wired up. */
  test(id: string): Promise<{ ok: boolean; error?: string }>;
}

export const NOTIFICATIONS_PORT = Symbol("NotificationsPort");

/**
 * Outbound alert delivery — isolated so the request path/tests never make real network calls.
 * Both Slack and generic webhooks are a JSON POST; the type only changes the body shape upstream.
 */
export interface NotificationDeliveryPort {
  deliver(url: string, body: string): Promise<{ ok: boolean; status?: number; error?: string }>;
}

export const NOTIFICATION_DELIVERY_PORT = Symbol("NotificationDeliveryPort");

/** One alert to enqueue for durable delivery to a channel. */
export interface EnqueueNotification {
  channelId: string;
  event: string;
  body: string;
}

/**
 * The durable delivery queue behind the alert channels — dispatch enqueues, the relay drains with
 * backoff and a dead-letter, so a briefly-offline Slack/Telegram no longer loses an alert on a crash.
 */
export interface NotificationQueuePort {
  enqueue(delivery: EnqueueNotification): Promise<void>;
  flush(): void;
  redrive(): Promise<number>;
  listDeliveries(): Promise<{ pending: NotificationDeliveryView[]; dead: NotificationDeliveryView[] }>;
}

export const NOTIFICATION_QUEUE_PORT = Symbol("NotificationQueuePort");
