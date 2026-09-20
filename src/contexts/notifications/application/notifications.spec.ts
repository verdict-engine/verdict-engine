import { beforeEach, describe, expect, it } from "vitest";
import { mock, type MockProxy } from "vitest-mock-extended";
import type { Clock } from "@shared/ports/clock.port";
import type { EventBus } from "@shared/ports/event-bus.port";
import type { DomainEvent } from "@shared/domain/domain-event";
import { MonotonicIdGenerator } from "@shared/adapters/monotonic-id-generator.adapter";
import { MemoryStore } from "@shared/adapters/memory-store.adapter";
import { NotificationsService } from "./notifications.service";
import { NotificationRelay } from "./notification-relay.service";
import type { NotificationDeliveryPort } from "./notifications.port";

const verdictEvent = (verdict: string): DomainEvent => ({
  name: "verdict.reached.v1",
  id: "evt_1",
  occurredAt: "2026-01-01T00:00:00.000Z",
  correlationId: "cor_1",
  payload: { verdict, score: 80, eventType: "card.authorize", eventId: "evt_1", reasons: [{ tag: "takeover", points: 33 }] },
});

describe("NotificationsService", () => {
  let store: MemoryStore;
  let bus: MockProxy<EventBus>;
  let delivery: MockProxy<NotificationDeliveryPort>;
  let clock: Clock;
  let now: number;
  let svc: NotificationsService;
  let relay: NotificationRelay;
  const handlers = new Map<string, (e: DomainEvent) => Promise<void>>();

  beforeEach(() => {
    store = new MemoryStore();
    bus = mock<EventBus>();
    bus.subscribe.mockImplementation((name, h) => handlers.set(name, h as (e: DomainEvent) => Promise<void>));
    delivery = mock<NotificationDeliveryPort>();
    delivery.deliver.mockResolvedValue({ ok: true, status: 200 });
    now = new Date("2026-01-01T00:00:00.000Z").getTime();
    clock = { now: () => new Date(now), isoNow: () => new Date(now).toISOString() };
    relay = new NotificationRelay(store, delivery, clock, new MonotonicIdGenerator(), bus);
    svc = new NotificationsService(store, bus, clock, delivery, relay);
    svc.onModuleInit();
  });

  // The bus handler dispatches fire-and-forget; let its microtasks (enqueue) settle before draining.
  const settle = () => new Promise((r) => setTimeout(r, 0));
  const fire = async (e: DomainEvent) => {
    await (handlers.get(e.name)?.(e) ?? Promise.resolve());
    await settle();
  };
  // Dispatch only enqueues; the relay does the actual delivery. Fire the event, then drain.
  const fireAndDrain = async (e: DomainEvent) => {
    await fire(e);
    await relay.drainOnce();
  };

  it("registers a channel and masks its URL in the view", async () => {
    const view = await svc.register({ type: "slack", url: "https://hooks.slack.com/services/T/B/secret", events: ["verdict.reached.v1"], createdBy: "admin" });
    expect(view.urlHint).toBe("https://hooks.slack.com/…");
    expect(JSON.stringify(view)).not.toContain("secret");
  });

  it("rejects a non-https url and an empty event list", async () => {
    await expect(svc.register({ type: "slack", url: "http://x", events: ["verdict.reached.v1"], createdBy: "a" })).rejects.toThrow(/https/);
    await expect(svc.register({ type: "slack", url: "https://x", events: [], createdBy: "a" })).rejects.toThrow(/at least one/);
  });

  it("delivers a Slack alert for a subscribed event", async () => {
    await svc.register({ type: "slack", url: "https://hooks.slack.com/x", events: ["verdict.reached.v1"], createdBy: "admin" });
    await fireAndDrain(verdictEvent("deny"));
    expect(delivery.deliver).toHaveBeenCalledOnce();
    const [url, body] = delivery.deliver.mock.calls[0];
    expect(url).toBe("https://hooks.slack.com/x");
    expect(JSON.parse(body).text).toContain("deny");
  });

  it("requires a chat id for Telegram and posts { chat_id, text }", async () => {
    await expect(
      svc.register({ type: "telegram", url: "https://api.telegram.org/bot123/sendMessage", events: ["verdict.reached.v1"], createdBy: "a" }),
    ).rejects.toThrow(/chat id/);

    await svc.register({ type: "telegram", url: "https://api.telegram.org/bot123/sendMessage", target: "-100999", events: ["verdict.reached.v1"], createdBy: "a" });
    await fireAndDrain(verdictEvent("deny"));

    const [url, body] = delivery.deliver.mock.calls[0];
    expect(url).toBe("https://api.telegram.org/bot123/sendMessage");
    const parsed = JSON.parse(body);
    expect(parsed.chat_id).toBe("-100999");
    expect(parsed.text).toContain("deny");
  });

  it("honors the minVerdict severity filter", async () => {
    await svc.register({ type: "slack", url: "https://hooks.slack.com/x", events: ["verdict.reached.v1"], minVerdict: "deny", createdBy: "admin" });
    await fireAndDrain(verdictEvent("review")); // below threshold
    expect(delivery.deliver).not.toHaveBeenCalled();
    await fireAndDrain(verdictEvent("deny")); // at threshold
    expect(delivery.deliver).toHaveBeenCalledOnce();
  });

  it("stops delivering after a channel is revoked", async () => {
    const v = await svc.register({ type: "webhook", url: "https://ops/x", events: ["verdict.reached.v1"], createdBy: "admin" });
    await svc.revoke(v.id);
    await fireAndDrain(verdictEvent("deny"));
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it("sends a test alert inline (no queue)", async () => {
    const v = await svc.register({ type: "slack", url: "https://hooks.slack.com/x", events: ["verdict.reached.v1"], createdBy: "admin" });
    const res = await svc.test(v.id);
    expect(res.ok).toBe(true);
    expect(delivery.deliver).toHaveBeenCalledOnce();
  });

  it("throttles alerts to a channel beyond its per-minute cap", async () => {
    await svc.register({ type: "webhook", url: "https://ops/x", events: ["verdict.reached.v1"], throttlePerMin: 2, createdBy: "admin" });

    // Three alerts inside the same minute: the first two enqueue, the third is dropped.
    for (let i = 0; i < 3; i++) await fire(verdictEvent("deny"));
    await relay.drainOnce();
    expect(delivery.deliver).toHaveBeenCalledTimes(2);

    // A minute later the window resets and delivery resumes.
    now += 61_000;
    await fireAndDrain(verdictEvent("deny"));
    expect(delivery.deliver).toHaveBeenCalledTimes(3);
  });
});
