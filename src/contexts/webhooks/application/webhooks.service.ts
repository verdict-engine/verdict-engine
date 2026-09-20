import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { DomainEvent } from "@shared/domain/domain-event";
import { CLOCK, type Clock } from "@shared/ports/clock.port";
import { EVENT_BUS, type EventBus } from "@shared/ports/event-bus.port";
import { ID_GENERATOR, type IdGenerator } from "@shared/ports/id-generator.port";
import { STORE, type Collection, type Store } from "@shared/ports/store.port";
import { logEvent } from "@shared/observability/log";
import { WEBHOOK_EVENTS, newSecret, summarize, type WebhookEndpoint, type WebhookView } from "../domain/webhook";
import {
  WEBHOOK_QUEUE_PORT,
  type RegisteredWebhook,
  type RegisterInput,
  type WebhookQueuePort,
  type WebhooksPort,
} from "./webhooks.port";

export class WebhookError extends Error {}

/**
 * Registers webhook endpoints and, on each subscribed engine event, enqueues a signed delivery to
 * every matching endpoint. Delivery itself is durable and runs off the bus in the WebhookRelay, so
 * a slow or offline receiver never blocks a decision and no event is lost across a restart.
 */
@Injectable()
export class WebhooksService implements WebhooksPort, OnModuleInit {
  private readonly endpoints: Collection<WebhookEndpoint>;

  constructor(
    @Inject(STORE) store: Store,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(WEBHOOK_QUEUE_PORT) private readonly queue: WebhookQueuePort,
  ) {
    this.endpoints = store.collection<WebhookEndpoint>("webhooks");
  }

  onModuleInit(): void {
    for (const name of WEBHOOK_EVENTS) {
      this.bus.subscribe(name, async (e) => {
        void this.dispatch(name, e);
      });
    }
  }

  async register(input: RegisterInput): Promise<RegisteredWebhook> {
    if (!/^https?:\/\//.test(input.url)) throw new WebhookError("url must be an http(s) URL");
    const events = (input.events ?? []).filter((x) => (WEBHOOK_EVENTS as readonly string[]).includes(x));
    if (events.length === 0) throw new WebhookError("subscribe to at least one known event");

    const endpoint: WebhookEndpoint = {
      id: this.ids.next("whk"),
      url: input.url,
      events,
      secret: newSecret(),
      active: true,
      createdAt: this.clock.isoNow(),
      createdBy: input.createdBy,
      failures: 0,
    };
    await this.endpoints.put(endpoint.id, endpoint);
    return { ...summarize(endpoint), secret: endpoint.secret };
  }

  async list(): Promise<WebhookView[]> {
    return (await this.endpoints.all()).map(summarize).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async revoke(id: string): Promise<void> {
    const e = await this.endpoints.get(id);
    if (e) await this.endpoints.put(id, { ...e, active: false });
  }

  private async dispatch(name: string, event: DomainEvent): Promise<void> {
    try {
      const targets = (await this.endpoints.all()).filter((e) => e.active && e.events.includes(name));
      if (targets.length === 0) return;
      const body = JSON.stringify({
        id: event.id,
        type: name,
        occurredAt: event.occurredAt,
        correlationId: event.correlationId,
        data: event.payload,
      });
      for (const e of targets) await this.queue.enqueue({ endpointId: e.id, event: name, body });
      this.queue.flush();
    } catch (cause) {
      logEvent("error", "webhook.dispatch_failed", { event: name, cause: cause instanceof Error ? cause.message : "unknown" });
    }
  }
}
