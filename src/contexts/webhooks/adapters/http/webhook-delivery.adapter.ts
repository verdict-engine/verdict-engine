import { Injectable } from "@nestjs/common";
import type { WebhookEndpoint } from "../../domain/webhook";
import type { WebhookDeliveryPort } from "../../application/webhooks.port";

const TIMEOUT_MS = 5000;

/** Real HTTP delivery via fetch, with a timeout so a hanging receiver can't pin a worker. */
@Injectable()
export class HttpWebhookDelivery implements WebhookDeliveryPort {
  async deliver(
    endpoint: WebhookEndpoint,
    body: string,
    headers: Record<string, string>,
  ): Promise<{ ok: boolean; status?: number; error?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(endpoint.url, { method: "POST", headers, body, signal: controller.signal });
      return { ok: res.ok, status: res.status, error: res.ok ? undefined : `status ${res.status}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "delivery error" };
    } finally {
      clearTimeout(timer);
    }
  }
}
