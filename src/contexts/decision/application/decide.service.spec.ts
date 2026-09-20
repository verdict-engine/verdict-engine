import { beforeEach, describe, expect, it } from "vitest";
import { mock, type MockProxy } from "vitest-mock-extended";
import type { Clock } from "@shared/ports/clock.port";
import type { IdGenerator } from "@shared/ports/id-generator.port";
import type { Store, TxContext } from "@shared/ports/store.port";
import type { AlertSettings } from "@shared/adapters/alert-settings";
import type { DeviceId, EventId, PolicyId, UserId, VerdictId } from "@shared/domain/ids";
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
import type { VerdictLogPort } from "./verdict-log.port";
import type { ReplayLogPort } from "./replay-log.port";
import type { ActivityLogPort } from "./activity-log.port";
import type { IdempotencyStore } from "./idempotency.port";
import type { OutboxPort } from "./outbox.port";

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

const EVENT: RiskEvent = {
  id: "evt_1" as EventId,
  type: "card.authorize",
  occurredAt: "2026-01-01T00:00:00Z",
  subject: { userId: "usr_1" as UserId, deviceId: "dev_1" as DeviceId },
  money: { amount: 4900, currency: "USD" },
  attributes: {},
};

describe("DecideService", () => {
  let features: MockProxy<FeatureStorePort>;
  let graph: MockProxy<GraphPort>;
  let anomaly: MockProxy<AnomalyPort>;
  let rules: MockProxy<RulesEnginePort>;
  let scorer: MockProxy<ScorerPort>;
  let lists: MockProxy<ListsPort>;
  let policies: MockProxy<PolicyRepositoryPort>;
  let log: MockProxy<VerdictLogPort>;
  let replay: MockProxy<ReplayLogPort>;
  let activity: MockProxy<ActivityLogPort>;
  let idem: MockProxy<IdempotencyStore>;
  let outbox: MockProxy<OutboxPort>;
  let ids: MockProxy<IdGenerator>;
  let clock: MockProxy<Clock>;
  let store: MockProxy<Store>;
  let alerts: MockProxy<AlertSettings>;
  let svc: DecideService;

  beforeEach(() => {
    features = mock<FeatureStorePort>();
    graph = mock<GraphPort>();
    anomaly = mock<AnomalyPort>();
    rules = mock<RulesEnginePort>();
    scorer = mock<ScorerPort>();
    lists = mock<ListsPort>();
    policies = mock<PolicyRepositoryPort>();
    log = mock<VerdictLogPort>();
    replay = mock<ReplayLogPort>();
    activity = mock<ActivityLogPort>();
    idem = mock<IdempotencyStore>();
    outbox = mock<OutboxPort>();
    ids = mock<IdGenerator>();
    clock = mock<Clock>();
    store = mock<Store>();
    alerts = mock<AlertSettings>();
    alerts.anomalyThreshold.mockResolvedValue(3);
    // Run the commit body against the mocked ports, as a real transaction would.
    store.transaction.mockImplementation((fn: (tx: TxContext) => Promise<unknown>) => fn(store));

    let n = 0;
    ids.next.mockImplementation((p) => `${p}_${n++}`);
    clock.isoNow.mockReturnValue("2026-01-01T00:00:00Z");
    idem.get.mockResolvedValue(undefined);
    idem.claim.mockResolvedValue(null); // won the claim → proceed with the commit
    lists.check.mockResolvedValue({ decision: "none" });
    policies.loadFor.mockResolvedValue(POLICY);
    features.snapshot.mockResolvedValue({
      velocity: { attemptsLast2m: 0, attemptsLast24h: 0, amountLast1h: 0 },
      device: { firstSeen: false, usersOnDevice: 0 },
      geo: { ipSimMismatch: false },
    });
    graph.featuresFor.mockResolvedValue({ usersOnDevice: 0, usersOnIp: 0, usersOnPhone: 0, devicesOnUser: 0, ringSize: 1 });
    anomaly.featuresFor.mockResolvedValue({ amountZScore: 0, amountMean: 0, samples: 0 });
    rules.evaluate.mockResolvedValue([]);
    scorer.score.mockResolvedValue({ value: 0, contributions: [], model: "m" });

    svc = new DecideService(
      features, graph, anomaly, rules, scorer, lists, policies, log, replay, activity, idem, outbox, ids, clock, store, alerts,
    );
  });

  it("returns the stored decision on an idempotent retry — no recompute", async () => {
    const prior = { id: "vd_prior" as VerdictId, verdict: "allow" } as Decision;
    idem.get.mockResolvedValue(prior);

    const r = await svc.decide(EVENT, "cor_1", "key-1");

    expect(r.ok && r.value).toBe(prior);
    expect(scorer.score).not.toHaveBeenCalled();
    expect(log.append).not.toHaveBeenCalled();
  });

  it("short-circuits to deny on a blocklist hit, skipping scoring", async () => {
    lists.check.mockResolvedValue({ decision: "deny", reason: "block:user" });

    const r = await svc.decide(EVENT, "cor_1");

    expect(r.ok && r.value.verdict).toBe("deny");
    expect(scorer.score).not.toHaveBeenCalled();
    expect(outbox.enqueue).toHaveBeenCalledOnce();
    expect(idem.claim).toHaveBeenCalledOnce(); // key claimed atomically inside the commit tx
  });

  it("returns the winner's decision without re-writing on a concurrent duplicate", async () => {
    const winner = { id: "vd_winner", verdict: "allow" } as Decision;
    idem.claim.mockResolvedValue(winner); // another request already committed this key

    const r = await svc.decide(EVENT, "cor_1");

    expect(r.ok && r.value).toBe(winner);
    expect(log.append).not.toHaveBeenCalled();
    expect(outbox.enqueue).not.toHaveBeenCalled();
  });

  it("routes a review verdict and records the event", async () => {
    scorer.score.mockResolvedValue({
      value: 55,
      contributions: [{ tag: "takeover", points: 33 }, { tag: "no_3ds", points: 22 }],
      model: "m",
    });

    const r = await svc.decide(EVENT, "cor_1");

    expect(r.ok && r.value.verdict).toBe("review");
    expect(features.record).toHaveBeenCalledOnce();
    expect(outbox.enqueue).toHaveBeenCalledOnce();
  });

  it("returns a challenge (step-up) for a mid-band score", async () => {
    scorer.score.mockResolvedValue({ value: 36, contributions: [], model: "m" });
    const r = await svc.decide(EVENT, "cor_1");
    expect(r.ok && r.value.verdict).toBe("challenge");
  });

  it("upgrades an allow to review on a watchlist hit", async () => {
    lists.check.mockResolvedValue({ decision: "watch" });
    scorer.score.mockResolvedValue({ value: 5, contributions: [], model: "m" });

    const r = await svc.decide(EVENT, "cor_1");

    expect(r.ok && r.value.verdict).toBe("review");
    expect(r.ok && r.value.reasons.some((x) => x.tag === "list.watch")).toBe(true);
  });

  it("emits an anomaly alert when the amount z-score crosses the threshold", async () => {
    anomaly.featuresFor.mockResolvedValue({ amountZScore: 5, amountMean: 100, samples: 20 });

    await svc.decide(EVENT, "cor_1");

    const names = outbox.enqueue.mock.calls.map((c) => c[0].name);
    expect(names).toContain("alert.anomaly.v1");
  });

  it("does not emit an anomaly alert below the threshold", async () => {
    anomaly.featuresFor.mockResolvedValue({ amountZScore: 1, amountMean: 100, samples: 20 });

    await svc.decide(EVENT, "cor_1");

    const names = outbox.enqueue.mock.calls.map((c) => c[0].name);
    expect(names).not.toContain("alert.anomaly.v1");
  });

  it("fails open to allow when a dependency throws (policy fail_open)", async () => {
    scorer.score.mockRejectedValue(new Error("scorer down"));

    const r = await svc.decide(EVENT, "cor_1");

    expect(r.ok && r.value.verdict).toBe("allow");
    expect(r.ok && r.value.reasons[0].tag).toBe("engine.degraded");
  });

  it("fails closed to deny when the policy says fail_closed", async () => {
    policies.loadFor.mockResolvedValue({ ...POLICY, onError: "fail_closed" });
    scorer.score.mockRejectedValue(new Error("scorer down"));

    const r = await svc.decide(EVENT, "cor_1");

    expect(r.ok && r.value.verdict).toBe("deny");
  });
});
