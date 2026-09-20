import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { CLOCK, type Clock } from "@shared/ports/clock.port";
import { EVENT_BUS, type EventBus } from "@shared/ports/event-bus.port";
import { ID_GENERATOR, type IdGenerator } from "@shared/ports/id-generator.port";
import { STORE, type Collection, type Store } from "@shared/ports/store.port";
import { Mutex } from "@shared/domain/mutex";
import { causeMessage, logEvent } from "@shared/observability/log";
import { deadLetterAlert } from "@shared/domain/alerts";
import {
  notificationDeadLetteredTotal,
  notificationDeliveredTotal,
  notificationFailedTotal,
  notificationPending,
} from "@shared/observability/metrics";
import type { NotificationChannel } from "../domain/notification";
import {
  NOTIFICATION_DELIVERY_COLLECTION,
  NOTIFICATION_DELIVERY_DLQ_COLLECTION,
  summarizeDelivery,
  type NotificationDeliveryRow,
  type NotificationDeliveryView,
} from "./notification-delivery.model";
import {
  NOTIFICATION_DELIVERY_PORT,
  type EnqueueNotification,
  type NotificationDeliveryPort,
  type NotificationQueuePort,
} from "./notifications.port";

const POLL_MS = 1000;
const BATCH = 50;
const MAX_ATTEMPTS = 6;
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 5 * 60 * 1000;

/**
 * Durable alert delivery. `enqueue` persists one row per (channel, event); the relay drains due rows
 * and POSTs the stored body. Delivered rows are removed; failures retry with exponential backoff; a
 * row that exhausts its attempts moves to the dead-letter and can be re-driven by an admin. This
 * replaces the old in-memory 3× retry so a briefly-offline Slack/Telegram no longer loses an alert
 * across a restart. The alerts are still advisory — a dead-lettered one also raises alert.dead_letter.v1.
 */
@Injectable()
export class NotificationRelay implements NotificationQueuePort, OnModuleInit, OnModuleDestroy {
  private readonly channels: Collection<NotificationChannel>;
  private readonly deliveries: Collection<NotificationDeliveryRow>;
  private readonly dlq: Collection<NotificationDeliveryRow>;
  private readonly channelLock = new Mutex();
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;

  constructor(
    @Inject(STORE) store: Store,
    @Inject(NOTIFICATION_DELIVERY_PORT) private readonly delivery: NotificationDeliveryPort,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
  ) {
    this.channels = store.collection<NotificationChannel>("notification-channels");
    this.deliveries = store.collection<NotificationDeliveryRow>(NOTIFICATION_DELIVERY_COLLECTION);
    this.dlq = store.collection<NotificationDeliveryRow>(NOTIFICATION_DELIVERY_DLQ_COLLECTION);
  }

  onModuleInit(): void {
    if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async enqueue({ channelId, event, body }: EnqueueNotification): Promise<void> {
    const now = this.clock.isoNow();
    const id = this.ids.next("ntd");
    const row: NotificationDeliveryRow = { id, channelId, event, body, status: "pending", attempts: 0, nextAttemptAt: now, createdAt: now };
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

  async listDeliveries(): Promise<{ pending: NotificationDeliveryView[]; dead: NotificationDeliveryView[] }> {
    const byNewest = (a: NotificationDeliveryRow, b: NotificationDeliveryRow) => b.createdAt.localeCompare(a.createdAt);
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
      logEvent("error", "notification.relay.tick_failed", { cause: causeMessage(cause) });
    } finally {
      this.ticking = false;
    }
  }

  /** One pass over due deliveries. Returns how many were delivered — used by tests. */
  async drainOnce(): Promise<number> {
    const now = this.clock.isoNow();
    const all = await this.deliveries.all();
    notificationPending.set(all.filter((r) => r.status === "pending").length);
    const due = all
      .filter((r) => r.status === "pending" && r.nextAttemptAt <= now)
      .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt))
      .slice(0, BATCH);

    let delivered = 0;
    for (const row of due) {
      const channel = await this.channels.get(row.channelId);
      if (!channel || !channel.active) {
        // The channel was revoked or removed — drop the delivery rather than retry forever.
        await this.deliveries.delete(row.id);
        continue;
      }
      const result = await this.delivery.deliver(channel.url, row.body);
      if (result.ok) {
        await this.deliveries.delete(row.id);
        await this.markChannel(row.channelId, { ok: true });
        notificationDeliveredTotal.inc({ event: row.event });
        delivered++;
      } else {
        await this.onFailure(row, result.error ?? `status ${result.status}`);
      }
    }
    return delivered;
  }

  private async onFailure(row: NotificationDeliveryRow, error: string): Promise<void> {
    notificationFailedTotal.inc({ event: row.event });
    const attempts = row.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      await this.dlq.put(row.id, { ...row, status: "dead", attempts, lastError: error });
      await this.deliveries.delete(row.id);
      await this.markChannel(row.channelId, { ok: false, error });
      notificationDeadLetteredTotal.inc({ event: row.event });
      logEvent("error", "notification.delivery.dead_lettered", { deliveryId: row.id, channelId: row.channelId, event: row.event, attempts, error });
      await this.bus
        .publish(deadLetterAlert({ source: "notification", ref: row.id, name: row.event, attempts, error }, this.clock.isoNow()))
        .catch(() => undefined);
      return;
    }
    const delay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempts - 1));
    const nextAttemptAt = new Date(new Date(this.clock.isoNow()).getTime() + delay).toISOString();
    await this.deliveries.put(row.id, { ...row, attempts, nextAttemptAt, lastError: error });
    logEvent("warn", "notification.delivery.retry_scheduled", { deliveryId: row.id, channelId: row.channelId, attempts, nextAttemptAt });
  }

  /** Update the channel's last-delivery status for the dashboard (serialized, best-effort). */
  private markChannel(id: string, outcome: { ok: true } | { ok: false; error: string }): Promise<void> {
    return this.channelLock.run(async () => {
      const c = await this.channels.get(id);
      if (!c) return;
      await this.channels.put(id, {
        ...c,
        lastStatus: outcome.ok ? "delivered" : "failed",
        lastAt: this.clock.isoNow(),
        lastError: outcome.ok ? undefined : outcome.error,
        failures: outcome.ok ? 0 : c.failures + 1,
      });
    });
  }
}
