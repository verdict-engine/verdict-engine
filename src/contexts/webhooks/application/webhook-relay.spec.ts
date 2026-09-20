import { beforeEach, describe, expect, it } from "vitest";
import { mock, type MockProxy } from "vitest-mock-extended";
import type { Clock } from "@shared/ports/clock.port";
import type { EventBus } from "@shared/ports/event-bus.port";
import type { IdGenerator } from "@shared/ports/id-generator.port";
import { MemoryStore } from "@shared/adapters/memory-store.adapter";
import type { WebhookEndpoint } from "../domain/webhook";
import type { WebhookDeliveryPort } from "./webhooks.port";
import {
  WEBHOOK_DELIVERY_COLLECTION,
  WEBHOOK_DELIVERY_DLQ_COLLECTION,
  type WebhookDeliveryRow,
} from "./webhook-delivery.model";
import { WebhookRelay } from "./webhook-relay.service";

const endpoint = (over: Partial<WebhookEndpoint> = {}): WebhookEndpoint => ({
  id: "whk_1",
  url: "https://receiver.test/hook",
  events: ["verdict.reached.v1"],
  secret: "whsec_abc",
  active: true,
  createdAt: "2026-01-01T00:00:00.000Z",
  createdBy: "admin",
  failures: 0,
  ...over,
});

describe("WebhookRelay", () => {
  let store: MemoryStore;
  let delivery: MockProxy<WebhookDeliveryPort>;
  let now: number;
  let clock: Clock;
  let ids: IdGenerator;
  let relay: WebhookRelay;

  beforeEach(async () => {
    store = new MemoryStore();
    delivery = mock<WebhookDeliveryPort>();
    now = new Date("2026-01-01T00:00:00.000Z").getTime();
    clock = { now: () => new Date(now), isoNow: () => new Date(now).toISOString() };
    let n = 0;
    ids = { next: (p: string) => `${p}_${n++}` };
    const bus = mock<EventBus>();
    bus.publish.mockResolvedValue(undefined);
    relay = new WebhookRelay(store, delivery, clock, ids, bus);
    await store.collection<WebhookEndpoint>("webhooks").put("whk_1", endpoint());
  });

  const pending = () => store.collection<WebhookDeliveryRow>(WEBHOOK_DELIVERY_COLLECTION).all();
  const dead = () => store.collection<WebhookDeliveryRow>(WEBHOOK_DELIVERY_DLQ_COLLECTION).all();
  const getEndpoint = () => store.collection<WebhookEndpoint>("webhooks").get("whk_1");
  const advance = (ms: number) => {
    now += ms;
  };

  it("delivers a pending row, signs it, removes it, and marks the endpoint delivered", async () => {
    delivery.deliver.mockResolvedValue({ ok: true, status: 200 });
    await relay.enqueue({ endpointId: "whk_1", event: "verdict.reached.v1", body: '{"x":1}' });

    const delivered = await relay.drainOnce();

    expect(delivered).toBe(1);
    expect(delivery.deliver).toHaveBeenCalledOnce();
    const headers = delivery.deliver.mock.calls[0][2];
    expect(headers["x-verdict-signature"]).toMatch(/^sha256=/);
    expect(await pending()).toHaveLength(0);
    expect((await getEndpoint())?.lastStatus).toBe("delivered");
  });

  it("drops a delivery whose endpoint was revoked", async () => {
    await store.collection<WebhookEndpoint>("webhooks").put("whk_1", endpoint({ active: false }));
    await relay.enqueue({ endpointId: "whk_1", event: "verdict.reached.v1", body: "{}" });

    await relay.drainOnce();

    expect(delivery.deliver).not.toHaveBeenCalled();
    expect(await pending()).toHaveLength(0);
  });

  it("retries with backoff, then dead-letters and marks the endpoint failed", async () => {
    delivery.deliver.mockResolvedValue({ ok: false, status: 500, error: "status 500" });
    await relay.enqueue({ endpointId: "whk_1", event: "verdict.reached.v1", body: "{}" });

    for (let i = 0; i < 20 && (await pending()).length > 0; i++) {
      await relay.drainOnce();
      advance(60 * 60 * 1000); // jump past any backoff
    }

    expect(await pending()).toHaveLength(0);
    const dlq = await dead();
    expect(dlq).toHaveLength(1);
    expect(dlq[0].status).toBe("dead");
    const e = await getEndpoint();
    expect(e?.lastStatus).toBe("failed");
    expect(e?.failures).toBe(1);
  });

  it("does not retry before the backoff elapses", async () => {
    delivery.deliver.mockResolvedValueOnce({ ok: false, error: "down" }).mockResolvedValue({ ok: true });
    await relay.enqueue({ endpointId: "whk_1", event: "verdict.reached.v1", body: "{}" });

    await relay.drainOnce(); // fails, schedules retry
    expect(await relay.drainOnce()).toBe(0); // still backing off
    advance(60_000);
    expect(await relay.drainOnce()).toBe(1); // delivered
  });

  it("re-drives dead-lettered deliveries back to pending", async () => {
    delivery.deliver.mockResolvedValue({ ok: false, error: "down" });
    await relay.enqueue({ endpointId: "whk_1", event: "verdict.reached.v1", body: "{}" });
    for (let i = 0; i < 20 && (await pending()).length > 0; i++) {
      await relay.drainOnce();
      advance(60 * 60 * 1000);
    }
    expect(await dead()).toHaveLength(1);

    const requeued = await relay.redrive();

    expect(requeued).toBe(1);
    expect(await dead()).toHaveLength(0);
    expect(await pending()).toHaveLength(1);
    expect((await pending())[0].status).toBe("pending");
  });
});
