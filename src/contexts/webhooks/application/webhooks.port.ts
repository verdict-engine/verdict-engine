import type { WebhookEndpoint, WebhookView } from "../domain/webhook";
import type { WebhookDeliveryView } from "./webhook-delivery.model";

export interface RegisterInput {
  url: string;
  events: string[];
  createdBy: string;
}

export interface RegisteredWebhook extends WebhookView {
  /** Returned once, on creation only — the receiver stores it to verify signatures. */
  secret: string;
}

export interface WebhooksPort {
  register(input: RegisterInput): Promise<RegisteredWebhook>;
  list(): Promise<WebhookView[]>;
  revoke(id: string): Promise<void>;
}

export const WEBHOOKS_PORT = Symbol("WebhooksPort");

/**
 * Outbound HTTP delivery — isolated so the request-path/tests never make real network calls.
 * Returns the outcome; retries and status are the queue's concern.
 */
export interface WebhookDeliveryPort {
  deliver(endpoint: WebhookEndpoint, body: string, headers: Record<string, string>): Promise<{ ok: boolean; status?: number; error?: string }>;
}

export const WEBHOOK_DELIVERY_PORT = Symbol("WebhookDeliveryPort");

export interface EnqueueDelivery {
  endpointId: string;
  event: string;
  body: string;
}

/**
 * The durable webhook-delivery queue. `enqueue` persists one delivery per (endpoint, event);
 * a relay drains it with retry/backoff and a dead-letter, so a slow or offline receiver never
 * loses an event and never blocks a decision. `flush` nudges an immediate drain after enqueue.
 */
export interface WebhookQueuePort {
  enqueue(delivery: EnqueueDelivery): Promise<void>;
  flush(): void;
  /** Move every dead-lettered delivery back to pending for another try. Returns how many. */
  redrive(): Promise<number>;
  listDeliveries(): Promise<{ pending: WebhookDeliveryView[]; dead: WebhookDeliveryView[] }>;
}

export const WEBHOOK_QUEUE_PORT = Symbol("WebhookQueuePort");
