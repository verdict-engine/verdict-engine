import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { CLOCK, type Clock } from "@shared/ports/clock.port";
import { EVENT_BUS, type EventBus } from "@shared/ports/event-bus.port";
import { ID_GENERATOR, type IdGenerator } from "@shared/ports/id-generator.port";
import { STORE, type Collection, type Store } from "@shared/ports/store.port";
import { Mutex } from "@shared/domain/mutex";
import { causeMessage, logEvent } from "@shared/observability/log";
import { deadLetterAlert } from "@shared/domain/alerts";
import {
  webhookDeadLetteredTotal,
  webhookDeliveredTotal,
  webhookFailedTotal,
  webhookPending,
} from "@shared/observability/metrics";
import { signBody, type WebhookEndpoint } from "../domain/webhook";
import {
  WEBHOOK_DELIVERY_COLLECTION,
  WEBHOOK_DELIVERY_DLQ_COLLECTION,
  summarizeDelivery,
  type WebhookDeliveryRow,
  type WebhookDeliveryView,
} from "./webhook-delivery.model";
import {
  WEBHOOK_DELIVERY_PORT,
  type EnqueueDelivery,
  type WebhookDeliveryPort,
  type WebhookQueuePort,
} from "./webhooks.port";

const POLL_MS = 1000;
const BATCH = 50;
const MAX_ATTEMPTS = 8;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 10 * 60 * 1000;

/**
 * Durable webhook delivery. `enqueue` persists one row per (endpoint, event); the relay drains due
 * rows, signs the stored body with the endpoint's current secret and POSTs it. Delivered rows are
 * removed; failures retry with exponential backoff; a row that exhausts its attempts moves to the
 * dead-letter and can be re-driven by an admin. This replaces the old in-memory 3× retry, so an
 * offline receiver no longer loses events across a restart.
 */
@Injectable()
export class WebhookRelay implements WebhookQueuePort, OnModuleInit, OnModuleDestroy {
  private readonly endpoints: Collection<WebhookEndpoint>;
  private readonly deliveries: Collection<WebhookDeliveryRow>;
  private readonly dlq: Collection<WebhookDeliveryRow>;
  private readonly endpointLock = new Mutex();
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;

  constructor(
    @Inject(STORE) store: Store,
    @Inject(WEBHOOK_DELIVERY_PORT) private readonly delivery: WebhookDeliveryPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
  ) {
    this.endpoints = store.collection<WebhookEndpoint>("webhooks");
    this.deliveries = store.collection<WebhookDeliveryRow>(WEBHOOK_DELIVERY_COLLECTION);
    this.dlq = store.collection<WebhookDeliveryRow>(WEBHOOK_DELIVERY_DLQ_COLLECTION);
  }

  onModuleInit(): void {
    if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async enqueue({ endpointId, event, body }: EnqueueDelivery): Promise<void> {
    const now = this.clock.isoNow();
    const id = this.ids.next("whd");
    const row: WebhookDeliveryRow = { id, endpointId, event, body, status: "pending", attempts: 0, nextAttemptAt: now, createdAt: now };
    await this.deliveries.put(id, row);
  }

  flush(): void {
    queueMicrotask(() => void this.tick());
  }

  async redrive(): Promise<number> {
    const dead = await this.dlq.all();
    const now = this.clock.isoNow();
    for (const row of dead) {
      await this.deliveries.put(row.id, { ...row, status: "pending", attempts: 0, nextAttemptAt: now, lastError: undefined });
      await this.dlq.delete(row.id);
    }
    if (dead.length > 0) this.flush();
    return dead.length;
  }

  async listDeliveries(): Promise<{ pending: WebhookDeliveryView[]; dead: WebhookDeliveryView[] }> {
    const byNewest = (a: WebhookDeliveryRow, b: WebhookDeliveryRow) => b.createdAt.localeCompare(a.createdAt);
    return {
      pending: (await this.deliveries.all()).sort(byNewest).map(summarizeDelivery),
      dead: (await this.dlq.all()).sort(byNewest).map(summarizeDelivery),
    };
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.drainOnce();
    } catch (cause) {
      logEvent("error", "webhook.relay.tick_failed", { cause: causeMessage(cause) });
    } finally {
      this.ticking = false;
    }
  }

  /** One pass over due deliveries. Returns how many were delivered — used by tests. */
  async drainOnce(): Promise<number> {
    const now = this.clock.isoNow();
    const all = await this.deliveries.all();
    webhookPending.set(all.filter((r) => r.status === "pending").length);
    const due = all
      .filter((r) => r.status === "pending" && r.nextAttemptAt <= now)
      .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt))
      .slice(0, BATCH);

    let delivered = 0;
    for (const row of due) {
      const endpoint = await this.endpoints.get(row.endpointId);
      if (!endpoint || !endpoint.active) {
        // The endpoint was revoked or removed — drop the delivery rather than retry forever.
        await this.deliveries.delete(row.id);
        continue;
      }
      const headers = {
        "content-type": "application/json",
        "x-verdict-event": row.event,
        "x-verdict-delivery": row.id,
        "x-verdict-signature": signBody(endpoint.secret, row.body),
      };
      const result = await this.delivery.deliver(endpoint, row.body, headers);
      if (result.ok) {
        await this.deliveries.delete(row.id);
        await this.markEndpoint(row.endpointId, { ok: true });
        webhookDeliveredTotal.inc({ event: row.event });
        delivered++;
      } else {
        await this.onFailure(row, result.error ?? `status ${result.status}`);
      }
    }
    return delivered;
  }

  private async onFailure(row: WebhookDeliveryRow, error: string): Promise<void> {
    webhookFailedTotal.inc({ event: row.event });
    const attempts = row.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await this.dlq.put(row.id, { ...row, status: "dead", attempts, lastError: error });
      await this.deliveries.delete(row.id);
      await this.markEndpoint(row.endpointId, { ok: false, error });
      webhookDeadLetteredTotal.inc({ event: row.event });
      logEvent("error", "webhook.delivery.dead_lettered", { deliveryId: row.id, endpointId: row.endpointId, event: row.event, attempts, error });
      await this.bus
        .publish(deadLetterAlert({ source: "webhook", ref: row.id, name: row.event, attempts, error }, this.clock.isoNow()))
        .catch(() => undefined);
      return;
    }
    const delay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempts - 1));
    const nextAttemptAt = new Date(new Date(this.clock.isoNow()).getTime() + delay).toISOString();
    await this.deliveries.put(row.id, { ...row, attempts, nextAttemptAt, lastError: error });
    logEvent("warn", "webhook.delivery.retry_scheduled", { deliveryId: row.id, endpointId: row.endpointId, attempts, nextAttemptAt });
  }

  /** Update the endpoint's last-delivery status for the dashboard (serialized, best-effort). */
  private markEndpoint(id: string, outcome: { ok: true } | { ok: false; error: string }): Promise<void> {
    return this.endpointLock.run(async () => {
      const e = await this.endpoints.get(id);
      if (!e) return;
      await this.endpoints.put(id, {
        ...e,
        lastStatus: outcome.ok ? "delivered" : "failed",
        lastAt: this.clock.isoNow(),
        lastError: outcome.ok ? undefined : outcome.error,
        failures: outcome.ok ? 0 : e.failures + 1,
      });
    });
  }
}
