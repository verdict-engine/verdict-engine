import { Injectable } from "@nestjs/common";
import type { NotificationDeliveryPort } from "../../application/notifications.port";

const TIMEOUT_MS = 5000;

/** Real HTTP delivery via fetch, with a timeout so a hanging channel can't pin a worker. */
@Injectable()
export class HttpNotificationDelivery implements NotificationDeliveryPort {
  async deliver(url: string, body: string): Promise<{ ok: boolean; status?: number; error?: string }> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    try {
      const res = await fetch(url, { method: "POST", headers: { "content-type": "application/json" }, body, signal: controller.signal });
      return { ok: res.ok, status: res.status, error: res.ok ? undefined : `status ${res.status}` };
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : "delivery error" };
    } finally {
      clearTimeout(timer);
    }
  }
}
