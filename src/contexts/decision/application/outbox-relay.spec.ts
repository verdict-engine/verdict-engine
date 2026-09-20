import { beforeEach, describe, expect, it } from "vitest";
import { mock, type MockProxy } from "vitest-mock-extended";
import type { EventBus } from "@shared/ports/event-bus.port";
import type { Clock } from "@shared/ports/clock.port";
import { MemoryStore } from "@shared/adapters/memory-store.adapter";
import type { DomainEvent } from "@shared/domain/domain-event";
import { OUTBOX_COLLECTION, OUTBOX_DLQ_COLLECTION, type OutboxRow } from "./outbox.model";
import { OutboxRelay } from "./outbox-relay.service";

const event = (id: string): DomainEvent => ({
  name: "verdict.reached.v1",
  id,
  occurredAt: "2026-01-01T00:00:00.000Z",
  correlationId: "cor_1",
  payload: { verdictId: id },
});

describe("OutboxRelay", () => {
  let store: MemoryStore;
  let bus: MockProxy<EventBus>;
  let now: number;
  let clock: Clock;
  let relay: OutboxRelay;

  beforeEach(() => {
    store = new MemoryStore();
    bus = mock<EventBus>();
    now = new Date("2026-01-01T00:00:00.000Z").getTime();
    clock = { now: () => new Date(now), isoNow: () => new Date(now).toISOString() };
    relay = new OutboxRelay(store, bus, clock);
  });

  const pending = () => store.collection<OutboxRow>(OUTBOX_COLLECTION).all();
  const dead = () => store.collection<OutboxRow>(OUTBOX_DLQ_COLLECTION).all();
  const advance = (ms: number) => {
    now += ms;
  };

  it("delivers a pending event and removes it", async () => {
    bus.publish.mockResolvedValue(undefined);
    await relay.enqueue(event("evt_1"));

    const delivered = await relay.drainOnce();

    expect(delivered).toBe(1);
    expect(bus.publish).toHaveBeenCalledOnce();
    expect(await pending()).toHaveLength(0);
  });

  it("retries with backoff on failure, not before nextAttemptAt", async () => {
    bus.publish.mockRejectedValue(new Error("bus down"));
    await relay.enqueue(event("evt_1"));

    expect(await relay.drainOnce()).toBe(0);
    const [row] = await pending();
    expect(row.attempts).toBe(1);
    expect(row.nextAttemptAt > clock.isoNow()).toBe(true); // scheduled into the future

    // A second drain before the backoff elapses does nothing.
    expect(await relay.drainOnce()).toBe(0);
    expect((await pending())[0].attempts).toBe(1);

    // After the backoff, it is tried again.
    advance(60_000);
    expect(await relay.drainOnce()).toBe(0);
    expect((await pending())[0].attempts).toBe(2);
  });

  it("dead-letters an event after exhausting its attempts", async () => {
    bus.publish.mockRejectedValue(new Error("bus down"));
    await relay.enqueue(event("evt_1"));

    for (let i = 0; i < 20 && (await pending()).length > 0; i++) {
      await relay.drainOnce();
      advance(60 * 60 * 1000); // jump past any backoff
    }

    expect(await pending()).toHaveLength(0);
    const dlq = await dead();
    expect(dlq).toHaveLength(1);
    expect(dlq[0].status).toBe("dead");
    expect(dlq[0].event.id).toBe("evt_1");
  });

  it("does not deliver an event whose backoff has not elapsed", async () => {
    bus.publish.mockRejectedValueOnce(new Error("bus down")).mockResolvedValue(undefined);
    await relay.enqueue(event("evt_1"));

    await relay.drainOnce(); // fails, schedules retry
    expect(await relay.drainOnce()).toBe(0); // still backing off
    advance(60_000);
    expect(await relay.drainOnce()).toBe(1); // now delivered
    expect(await pending()).toHaveLength(0);
  });
});
