import { beforeEach, describe, expect, it } from "vitest";
import { mock, type MockProxy } from "vitest-mock-extended";
import type { Clock } from "@shared/ports/clock.port";
import type { EventBus } from "@shared/ports/event-bus.port";
import { MemoryStore } from "@shared/adapters/memory-store.adapter";
import { MonotonicIdGenerator } from "@shared/adapters/monotonic-id-generator.adapter";
import type { NotificationChannel } from "../domain/notification";
import { NotificationRelay } from "./notification-relay.service";
import { NOTIFICATION_DELIVERY_COLLECTION, NOTIFICATION_DELIVERY_DLQ_COLLECTION, type NotificationDeliveryRow } from "./notification-delivery.model";
import type { NotificationDeliveryPort } from "./notifications.port";

const channel = (id: string): NotificationChannel => ({
  id,
  type: "webhook",
  url: "https://ops.example/hook",
  events: ["verdict.reached.v1"],
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: "admin",
  failures: 0,
});

describe("NotificationRelay", () => {
  let store: MemoryStore;
  let delivery: MockProxy<NotificationDeliveryPort>;
  let bus: MockProxy<EventBus>;
  let now: number;
  let clock: Clock;
  let relay: NotificationRelay;

  beforeEach(async () => {
    store = new MemoryStore();
    delivery = mock<NotificationDeliveryPort>();
    bus = mock<EventBus>();
    bus.publish.mockResolvedValue(undefined);
    now = new Date("2026-01-01T00:00:00.000Z").getTime();
    clock = { now: () => new Date(now), isoNow: () => new Date(now).toISOString() };
    relay = new NotificationRelay(store, delivery, clock, new MonotonicIdGenerator(), bus);
    await store.collection<NotificationChannel>("notification-channels").put("ch_1", channel("ch_1"));
  });

  const pending = () => store.collection<NotificationDeliveryRow>(NOTIFICATION_DELIVERY_COLLECTION).all();
  const dead = () => store.collection<NotificationDeliveryRow>(NOTIFICATION_DELIVERY_DLQ_COLLECTION).all();
  const advance = (ms: number) => {
    now += ms;
  };

  it("delivers a pending alert and removes it", async () => {
    delivery.deliver.mockResolvedValue({ ok: true, status: 200 });
    await relay.enqueue({ channelId: "ch_1", event: "verdict.reached.v1", body: "{}" });

    expect(await relay.drainOnce()).toBe(1);
    expect(await pending()).toHaveLength(0);
  });

  it("retries with backoff and dead-letters after exhausting attempts", async () => {
    delivery.deliver.mockResolvedValue({ ok: false, status: 500, error: "server error" });
    await relay.enqueue({ channelId: "ch_1", event: "verdict.reached.v1", body: "{}" });

    for (let i = 0; i < 20 && (await pending()).length > 0; i++) {
      await relay.drainOnce();
      advance(60 * 60 * 1000); // jump past any backoff
    }

    expect(await pending()).toHaveLength(0);
    const dlq = await dead();
    expect(dlq).toHaveLength(1);
    expect(dlq[0].status).toBe("dead");
    // Dead-lettering an alert raises an operational alert of its own.
    expect(bus.publish).toHaveBeenCalled();
  });

  it("drops a delivery whose channel was revoked instead of retrying forever", async () => {
    await store.collection<NotificationChannel>("notification-channels").put("ch_1", { ...channel("ch_1"), active: false });
    await relay.enqueue({ channelId: "ch_1", event: "verdict.reached.v1", body: "{}" });

    expect(await relay.drainOnce()).toBe(0);
    expect(await pending()).toHaveLength(0);
    expect(delivery.deliver).not.toHaveBeenCalled();
  });

  it("re-drives dead-lettered alerts back onto the queue", async () => {
    delivery.deliver.mockResolvedValue({ ok: false, status: 500, error: "down" });
    await relay.enqueue({ channelId: "ch_1", event: "verdict.reached.v1", body: "{}" });
    for (let i = 0; i < 20 && (await pending()).length > 0; i++) {
      await relay.drainOnce();
      advance(60 * 60 * 1000);
    }
    expect(await dead()).toHaveLength(1);

    const requeued = await relay.redrive();
    expect(requeued).toBe(1);
    expect(await dead()).toHaveLength(0);
    expect(await pending()).toHaveLength(1);

    delivery.deliver.mockResolvedValue({ ok: true, status: 200 });
    expect(await relay.drainOnce()).toBe(1);
  });
});
