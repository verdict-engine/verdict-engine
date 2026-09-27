import { describe, expect, it, vi } from "vitest";
import { mock, type MockProxy } from "vitest-mock-extended";
import type { Clock } from "@shared/ports/clock.port";
import type { DomainEvent } from "@shared/domain/domain-event";
import type { EventBus } from "@shared/ports/event-bus.port";
import { MemoryStore } from "@shared/adapters/memory-store.adapter";
import { MonotonicIdGenerator } from "@shared/adapters/monotonic-id-generator.adapter";
import type { Collection, Store, TxContext } from "@shared/ports/store.port";
import type { AlertSettings } from "@shared/adapters/alert-settings";
import type { DeviceId, EventId, PolicyId, UserId } from "@shared/domain/ids";
import type { FeatureStorePort } from "@contexts/feature-store/application/feature-store.port";
import type { RiskEvent } from "@contexts/ingest/application/ingest.port";
import type { GraphPort } from "@contexts/graph/application/graph.port";
import type { AnomalyPort } from "@contexts/anomaly/application/anomaly.port";
import type { RulesEnginePort } from "@contexts/rules/application/rules-engine.port";
import type { ScorerPort } from "@contexts/scoring/application/scorer.port";
import type { ListsPort } from "@contexts/lists/application/lists.port";
import type { Policy } from "../domain/policy";
import type { Decision } from "../domain/verdict";
import { DecideService } from "./decide.service";
import type { PolicyRepositoryPort } from "./policy-repository.port";
import { StoreVerdictLog } from "../adapters/store/store-verdict-log.adapter";
import { StoreReplayLog } from "../adapters/store/store-replay-log.adapter";
import { StoreActivityLog } from "../adapters/store/store-activity-log.adapter";
import { StoreIdempotency } from "../adapters/store/store-idempotency.adapter";
import { OutboxRelay } from "./outbox-relay.service";
import { OUTBOX_COLLECTION, type OutboxRow } from "./outbox.model";

/**
 * Failure-injection tests: instead of mocking the persistence seam, these wire DecideService to the
 * *real* store-backed logs, idempotency and outbox against an in-memory Store, then inject the
 * failures a production deployment actually sees — a slow/unavailable database, a dead feature store
 * (Redis), duplicate idempotency keys arriving at once, a crash after the verdict commits but before
 * the relay runs, and a delivery storm. Each asserts the engine's crash-safety contract: a decision
 * is committed exactly once with its outbox event, or not at all.
 */

const POLICY: Policy = {
  id: "pol_test" as PolicyId,
  version: "v1",
  onError: "fail_open",
  bands: [
    { verdict: "allow", min: 0, max: 24 },
    { verdict: "challenge", min: 25, max: 44 },
    { verdict: "review", min: 45, max: 69, reviewQueue: "risk-ops" },
    { verdict: "deny", min: 70, max: 100 },
  ],
};

const eventWith = (id: string): RiskEvent => ({
  id: id as EventId,
  type: "card.authorize",
  occurredAt: "2026-01-01T00:00:00Z",
  subject: { userId: "usr_1" as UserId, deviceId: "dev_1" as DeviceId },
  money: { amount: 4900, currency: "USD" },
  attributes: {},
});

/** A Store that delegates to an inner one but can be flipped to fail transactions (a DB outage). */
class FaultStore implements Store {
  failTransaction = false;
  constructor(private readonly inner: Store) {}
  collection<T>(name: string): Collection<T> {
    return this.inner.collection<T>(name);
  }
  transaction<R>(fn: (tx: TxContext) => Promise<R>): Promise<R> {
    if (this.failTransaction) return Promise.reject(new Error("database unavailable"));
    return this.inner.transaction(fn);
  }
  stats() {
    return this.inner.stats();
  }
  reclaim() {
    return this.inner.reclaim();
  }
}

interface Harness {
  svc: DecideService;
  store: MemoryStore;
  outbox: OutboxRelay;
  bus: MockProxy<EventBus>;
  features: MockProxy<FeatureStorePort>;
  verdictCount: () => Promise<number>;
  outboxRows: () => Promise<OutboxRow[]>;
}

function makeHarness(overrides: { store?: Store; bus?: MockProxy<EventBus> } = {}): Harness {
  const store = new MemoryStore();
  const backing: Store = overrides.store ?? store;
  let bus = overrides.bus;
  if (!bus) {
    bus = mock<EventBus>();
    bus.publish.mockResolvedValue(undefined);
  }

  const clock: Clock = { now: () => new Date("2026-01-01T00:00:00Z"), isoNow: () => "2026-01-01T00:00:00Z" };
  const ids = new MonotonicIdGenerator();

  const features = mock<FeatureStorePort>();
  const graph = mock<GraphPort>();
  const anomaly = mock<AnomalyPort>();
  const rules = mock<RulesEnginePort>();
  const scorer = mock<ScorerPort>();
  const lists = mock<ListsPort>();
  const policies = mock<PolicyRepositoryPort>();
  const alerts = mock<AlertSettings>();
  alerts.anomalyThreshold.mockResolvedValue(3);
  lists.check.mockResolvedValue({ decision: "none" });
  policies.loadFor.mockResolvedValue(POLICY);
  features.snapshot.mockResolvedValue({
    velocity: { attemptsLast2m: 0, attemptsLast24h: 0, amountLast1h: 0 },
    device: { firstSeen: false, usersOnDevice: 0, fingerprintFirstSeen: false, usersOnFingerprint: 0, fingerprintDeviceMismatch: false },
    geo: { ipSimMismatch: false, impossibleTravel: false, countryChanged: false },
  });
  graph.featuresFor.mockResolvedValue({ usersOnDevice: 0, usersOnIp: 0, usersOnPhone: 0, devicesOnUser: 0, ringSize: 1 });
  anomaly.featuresFor.mockResolvedValue({ amountZScore: 0, amountMean: 0, samples: 0 });
  rules.evaluate.mockResolvedValue([]);
  scorer.score.mockResolvedValue({ value: 0, contributions: [], model: "m" });

  const outbox = new OutboxRelay(backing, bus, clock);
  // Stub the fire-and-forget post-commit flush so delivery only happens when a test drives drainOnce()
  // — the background tick would otherwise race the assertions (delivering and deleting outbox rows).
  vi.spyOn(outbox, "flush").mockImplementation(() => undefined);
  const svc = new DecideService(
    features, graph, anomaly, rules, scorer, lists, policies,
    new StoreVerdictLog(backing), new StoreReplayLog(backing), new StoreActivityLog(backing),
    new StoreIdempotency(backing), outbox, ids, clock, backing, alerts,
  );

  return {
    svc,
    store,
    outbox,
    bus,
    features,
    verdictCount: async () => (await store.collection<Decision>("verdicts").all()).length,
    outboxRows: () => store.collection<OutboxRow>(OUTBOX_COLLECTION).all(),
  };
}

describe("failure injection", () => {
  it("commits exactly one verdict + outbox event under concurrent duplicate idempotency keys", async () => {
    const h = makeHarness();
    const key = "idem-key-1";

    const results = await Promise.all(Array.from({ length: 25 }, () => h.svc.decide(eventWith("evt_dup"), "cor_1", key)));

    const ids = new Set(results.map((r) => (r.ok ? r.value.id : "err")));
    expect(ids.size).toBe(1);
    expect(await h.verdictCount()).toBe(1);
    expect(await h.outboxRows()).toHaveLength(1); // one verdict.reached.v1, not 25
  });

  it("recovers the verdict's event after a crash that happened before the relay ran", async () => {
    // Commit a decision; the relay never runs (the flush is stubbed) — a crash right after the
    // verdict committed but before its event went out.
    const h = makeHarness();
    await h.svc.decide(eventWith("evt_crash"), "cor_1", "key-crash");
    expect(await h.outboxRows()).toHaveLength(1); // durably staged, not delivered

    // A fresh relay on the same store (a restarted process) drains and delivers exactly once.
    const revived = mock<EventBus>();
    revived.publish.mockResolvedValue(undefined);
    const relay2 = new OutboxRelay(h.store, revived, {
      now: () => new Date("2026-01-01T00:01:00Z"),
      isoNow: () => "2026-01-01T00:01:00Z",
    });
    const delivered = await relay2.drainOnce();

    expect(delivered).toBe(1);
    expect(revived.publish).toHaveBeenCalledOnce();
    expect(await h.outboxRows()).toHaveLength(0);
    expect(await h.verdictCount()).toBe(1); // still one verdict — no double-write on recovery
  });

  it("returns no verdict and writes nothing when the database is unavailable at commit", async () => {
    const fault = new FaultStore(new MemoryStore());
    fault.failTransaction = true;
    const h = makeHarness({ store: fault });

    await expect(h.svc.decide(eventWith("evt_db_down"), "cor_1")).rejects.toThrow(/database unavailable/);
    // Fail-closed on persistence: nothing partially committed, no verdict handed back.
    expect(await fault.collection<Decision>("verdicts").all()).toHaveLength(0);
    expect(await fault.collection<OutboxRow>(OUTBOX_COLLECTION).all()).toHaveLength(0);
  });

  it("degrades to the policy outcome (and still commits) when the feature store is down", async () => {
    const h = makeHarness();
    h.features.snapshot.mockRejectedValue(new Error("redis unavailable"));

    const r = await h.svc.decide(eventWith("evt_redis_down"), "cor_1");

    expect(r.ok && r.value.verdict).toBe("allow"); // policy.onError = fail_open
    expect(r.ok && r.value.reasons[0].tag).toBe("engine.degraded");
    expect(await h.verdictCount()).toBe(1); // the degraded decision is still recorded durably
  });

  it("absorbs a delivery storm into the dead-letter without ever throwing", async () => {
    const bus = mock<EventBus>();
    bus.publish.mockRejectedValue(new Error("consumer overloaded")); // every delivery fails
    const h = makeHarness({ bus });
    const clockNow = { t: new Date("2026-01-01T00:00:00Z").getTime() };
    // A private clock we can advance past the backoff between drains.
    const relay = new OutboxRelay(h.store, bus, {
      now: () => new Date(clockNow.t),
      isoNow: () => new Date(clockNow.t).toISOString(),
    });

    const stormEvent = (i: number): DomainEvent => ({
      name: "verdict.reached.v1",
      id: `evt_storm_${i}`,
      occurredAt: "2026-01-01T00:00:00.000Z",
      correlationId: "cor_storm",
      payload: { verdictId: `vd_${i}` },
    });
    for (let i = 0; i < 60; i++) await relay.enqueue(stormEvent(i));

    // Drain repeatedly, jumping past backoff each time; no drain should reject despite every send failing.
    for (let i = 0; i < 30 && (await h.outboxRows()).length > 0; i++) {
      await expect(relay.drainOnce()).resolves.toBeTypeOf("number");
      clockNow.t += 60 * 60 * 1000;
    }

    expect(await h.outboxRows()).toHaveLength(0); // all drained out of the pending queue
    expect(await h.store.collection<OutboxRow>("outbox_dead").all()).toHaveLength(60); // and safely parked
  });
});

describe("load / volume correctness", () => {
  it("commits 500 concurrent unique decisions exactly once each, with no duplicates", async () => {
    const h = makeHarness();
    const N = 500;

    const results = await Promise.all(
      Array.from({ length: N }, (_, i) => h.svc.decide(eventWith(`evt_load_${i}`), "cor_load", `key_load_${i}`)),
    );

    const ids = new Set(results.map((r) => (r.ok ? r.value.id : "err")));
    expect(ids.size).toBe(N);
    expect(await h.verdictCount()).toBe(N);
    expect(await h.outboxRows()).toHaveLength(N); // one verdict.reached.v1 per decision
  });
});
