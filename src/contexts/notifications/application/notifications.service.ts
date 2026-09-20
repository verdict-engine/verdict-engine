import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { DomainEvent } from "@shared/domain/domain-event";
import { CLOCK, type Clock } from "@shared/ports/clock.port";
import { EVENT_BUS, type EventBus } from "@shared/ports/event-bus.port";
import { STORE, type Collection, type Store } from "@shared/ports/store.port";
import { causeMessage, logEvent } from "@shared/observability/log";
import { notificationThrottledTotal } from "@shared/observability/metrics";
import { NOTIFY } from "../../../config/notifications";
import { bodyFor, formatMessage } from "../domain/format";
import { WindowThrottle } from "../domain/throttle";
import {
  NOTIFY_EVENTS,
  VERDICT_RANK,
  newChannelId,
  summarizeChannel,
  type ChannelView,
  type NotificationChannel,
  type NotifyEvent,
} from "../domain/notification";
import {
  NOTIFICATION_DELIVERY_PORT,
  NOTIFICATION_QUEUE_PORT,
  type NotificationDeliveryPort,
  type NotificationQueuePort,
  type NotificationsPort,
  type RegisterChannelInput,
} from "./notifications.port";

export class NotificationError extends Error {}

/**
 * Turns engine events into alerts on operator-configured channels (Slack, Telegram or a generic
 * HTTPS endpoint). It runs off the event bus, so a slow channel never touches a decision. Dispatch
 * only decides *who* gets an alert (subscription, severity and per-channel throttle) and enqueues it;
 * the actual delivery is durable and retried in the NotificationRelay, so a briefly-offline channel
 * doesn't lose an alert across a restart.
 */
@Injectable()
export class NotificationsService implements NotificationsPort, OnModuleInit {
  private readonly channels: Collection<NotificationChannel>;
  private readonly throttle = new WindowThrottle();

  constructor(
    @Inject(STORE) store: Store,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(NOTIFICATION_DELIVERY_PORT) private readonly delivery: NotificationDeliveryPort,
    @Inject(NOTIFICATION_QUEUE_PORT) private readonly queue: NotificationQueuePort,
  ) {
    this.channels = store.collection<NotificationChannel>("notification-channels");
  }

  onModuleInit(): void {
    for (const name of NOTIFY_EVENTS) {
      this.bus.subscribe(name, async (e) => {
        void this.dispatch(name, e);
      });
    }
  }

  async register(input: RegisterChannelInput): Promise<ChannelView> {
    if (!["slack", "webhook", "telegram"].includes(input.type)) throw new NotificationError("type must be slack, webhook or telegram");
    if (!/^https:\/\//.test(input.url)) throw new NotificationError("url must be an https URL");
    if (input.type === "telegram" && !input.target?.trim()) throw new NotificationError("telegram needs a target chat id");
    const events = input.events.filter((x) => (NOTIFY_EVENTS as readonly string[]).includes(x));
    if (events.length === 0) throw new NotificationError("subscribe to at least one known event");
    if (input.throttlePerMin !== undefined && (!Number.isInteger(input.throttlePerMin) || input.throttlePerMin < 0)) {
      throw new NotificationError("throttlePerMin must be a whole number ≥ 0 (0 = unlimited)");
    }

    const channel: NotificationChannel = {
      id: newChannelId(),
      type: input.type,
      url: input.url,
      target: input.type === "telegram" ? input.target?.trim() : undefined,
      events,
      minVerdict: input.minVerdict,
      throttlePerMin: input.throttlePerMin,
      active: true,
      createdAt: this.clock.isoNow(),
      createdBy: input.createdBy,
      failures: 0,
    };
    await this.channels.put(channel.id, channel);
    return summarizeChannel(channel);
  }

  async list(): Promise<ChannelView[]> {
    return (await this.channels.all()).map(summarizeChannel).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async revoke(id: string): Promise<void> {
    const c = await this.channels.get(id);
    if (c) await this.channels.put(id, { ...c, active: false });
  }

  async test(id: string): Promise<{ ok: boolean; error?: string }> {
    const c = await this.channels.get(id);
    if (!c) throw new NotificationError("channel not found");
    // Delivered inline (not queued) so the operator gets immediate pass/fail feedback.
    const text = "✅ Verdict test alert — this channel is wired up.";
    const result = await this.delivery.deliver(c.url, bodyFor(c.type, testEvent(this.clock.isoNow()), text, c.target));
    return { ok: result.ok, error: result.ok ? undefined : result.error ?? `status ${result.status}` };
  }

  private async dispatch(name: string, event: DomainEvent): Promise<void> {
    try {
      // Don't re-notify a dead-letter that a notification failure itself raised — that would loop.
      if (name === "alert.dead_letter.v1" && (event.payload as { source?: string }).source === "notification") return;
      const targets = (await this.channels.all()).filter(
        (c) => c.active && c.events.includes(name as NotifyEvent) && this.passesFilter(c, name, event),
      );
      if (targets.length === 0) return;
      const text = formatMessage(event);
      const now = this.clock.now().getTime();
      let enqueued = false;
      for (const c of targets) {
        const limit = c.throttlePerMin ?? NOTIFY.throttlePerMin;
        if (!this.throttle.allow(c.id, limit, now)) {
          notificationThrottledTotal.inc({ event: name });
          logEvent("warn", "notification.throttled", { channelId: c.id, event: name, limitPerMin: limit });
          continue;
        }
        await this.queue.enqueue({ channelId: c.id, event: name, body: bodyFor(c.type, event, text, c.target) });
        enqueued = true;
      }
      if (enqueued) this.queue.flush();
    } catch (cause) {
      logEvent("error", "notification.dispatch_failed", { event: name, cause: causeMessage(cause) });
    }
  }

  /** verdict.reached honors a per-channel minimum severity; other events always pass. */
  private passesFilter(c: NotificationChannel, name: string, event: DomainEvent): boolean {
    if (name !== "verdict.reached.v1" || !c.minVerdict) return true;
    const verdict = (event.payload as { verdict?: string }).verdict ?? "allow";
    return (VERDICT_RANK[verdict] ?? 0) >= (VERDICT_RANK[c.minVerdict] ?? 0);
  }
}

const testEvent = (occurredAt: string): DomainEvent => ({
  name: "test",
  id: "test",
  occurredAt,
  correlationId: "test",
  payload: {},
});
