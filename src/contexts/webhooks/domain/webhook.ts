import { createHmac, randomBytes } from "node:crypto";

/** The engine events a webhook can subscribe to. */
export const WEBHOOK_EVENTS = ["verdict.reached.v1", "case.resolved.v1", "label.recorded.v1"] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export interface WebhookEndpoint {
  readonly id: string;
  readonly url: string;
  readonly events: string[];
  /** Shared secret the receiver uses to verify the HMAC signature — stored to sign with. */
  readonly secret: string;
  readonly active: boolean;
  readonly createdAt: string;
  readonly createdBy: string;
  lastStatus?: "delivered" | "failed";
  lastAt?: string;
  lastError?: string;
  failures: number;
}

/** What the receiver sees, without the signing secret. */
export interface WebhookView {
  id: string;
  url: string;
  events: string[];
  active: boolean;
  createdAt: string;
  createdBy: string;
  lastStatus?: "delivered" | "failed";
  lastAt?: string;
  failures: number;
}

export const newSecret = (): string => `whsec_${randomBytes(24).toString("hex")}`;

/** `sha256=<hex>` HMAC of the exact request body — the receiver recomputes it to verify authenticity. */
export const signBody = (secret: string, body: string): string =>
  `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

export function summarize(e: WebhookEndpoint): WebhookView {
  return {
    id: e.id, url: e.url, events: e.events, active: e.active,
    createdAt: e.createdAt, createdBy: e.createdBy,
    lastStatus: e.lastStatus, lastAt: e.lastAt, failures: e.failures,
  };
}
