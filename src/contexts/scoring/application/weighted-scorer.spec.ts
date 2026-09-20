import { describe, expect, it } from "vitest";
import type { FeatureSnapshot } from "@contexts/feature-store/application/feature-store.port";
import type { RuleHit } from "@contexts/rules/application/rules-engine.port";
import { WeightedScorer } from "./weighted-scorer.service";

const features = {} as FeatureSnapshot;
const scorer = new WeightedScorer();

describe("WeightedScorer", () => {
  it("sums rule weights into a score", async () => {
    const hits: RuleHit[] = [
      { ruleId: "a", tag: "velocity", weight: 28 },
      { ruleId: "b", tag: "takeover", weight: 33 },
    ];
    const s = await scorer.score(hits, features);
    expect(s.value).toBe(61);
    expect(s.model).toContain("weighted");
  });

  it("aggregates contributions per tag", async () => {
    const hits: RuleHit[] = [
      { ruleId: "a", tag: "velocity", weight: 10 },
      { ruleId: "b", tag: "velocity", weight: 5 },
    ];
    const s = await scorer.score(hits, features);
    expect(s.contributions).toEqual([{ tag: "velocity", points: 15 }]);
  });

  it("clamps to 100", async () => {
    const hits: RuleHit[] = [
      { ruleId: "a", tag: "x", weight: 80 },
      { ruleId: "b", tag: "y", weight: 80 },
    ];
    expect((await scorer.score(hits, features)).value).toBe(100);
  });

  it("scores no hits as 0 → allow territory", async () => {
    expect((await scorer.score([], features)).value).toBe(0);
  });
});
