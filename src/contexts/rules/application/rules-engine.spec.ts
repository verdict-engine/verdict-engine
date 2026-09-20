import { describe, expect, it } from "vitest";
import { mock } from "vitest-mock-extended";
import type { EventId, UserId } from "@shared/domain/ids";
import type { FeatureSnapshot } from "@contexts/feature-store/application/feature-store.port";
import type { RiskEvent } from "@contexts/ingest/application/ingest.port";
import type { Rule } from "../domain/rule";
import { RulesEngineService } from "./rules-engine.service";
import type { RulesetRepositoryPort } from "./ruleset-repository.port";

const rules: Rule[] = [
  {
    id: "r_velocity",
    name: "r_velocity",
    tag: "velocity",
    weight: 28,
    condition: { kind: "compare", path: "velocity.attemptsLast2m", op: "gt", value: 4 },
  },
  {
    id: "r_amount",
    name: "r_amount",
    tag: "amount",
    weight: 14,
    condition: { kind: "compare", path: "event.amount", op: "gt", value: 3000 },
  },
];

const event = (): RiskEvent => ({
  id: "evt_1" as EventId,
  type: "card.authorize",
  occurredAt: "2026-01-01T00:00:00Z",
  subject: { userId: "usr_1" as UserId },
  money: { amount: 5000, currency: "USD" },
  attributes: {},
});

const features = (attemptsLast2m: number): FeatureSnapshot => ({
  velocity: { attemptsLast2m, attemptsLast24h: 0, amountLast1h: 0 },
  device: { firstSeen: false, usersOnDevice: 0 },
  geo: { ipSimMismatch: false },
});

describe("RulesEngineService", () => {
  it("returns hits for every matched rule", async () => {
    const repo = mock<RulesetRepositoryPort>();
    repo.load.mockResolvedValue({ version: "t", rules });
    const engine = new RulesEngineService(repo);

    const hits = await engine.evaluate(event(), features(6)); // velocity>4 AND amount>3000
    expect(hits.map((h) => h.tag).sort()).toEqual(["amount", "velocity"]);
  });

  it("omits rules whose condition is false", async () => {
    const repo = mock<RulesetRepositoryPort>();
    repo.load.mockResolvedValue({ version: "t", rules });
    const engine = new RulesEngineService(repo);

    const hits = await engine.evaluate(event(), features(1)); // velocity 1 → only amount fires
    expect(hits.map((h) => h.tag)).toEqual(["amount"]);
  });

  it("returns no hits for an unknown event type (empty ruleset)", async () => {
    const repo = mock<RulesetRepositoryPort>();
    repo.load.mockResolvedValue({ version: "t", rules: [] });
    const engine = new RulesEngineService(repo);

    expect(await engine.evaluate(event(), features(9))).toEqual([]);
  });
});
