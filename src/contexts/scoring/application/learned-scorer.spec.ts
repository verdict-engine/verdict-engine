import { describe, expect, it } from "vitest";
import { mock } from "vitest-mock-extended";
import type { FeatureSnapshot } from "@contexts/feature-store/application/feature-store.port";
import type { RuleHit } from "@contexts/rules/application/rules-engine.port";
import { LearnedScorer } from "./learned-scorer.service";
import type { ModelPort, TagWeight } from "./model.port";

const features = {} as FeatureSnapshot;

const learned = (tag: string, weight: number, trusted: boolean): TagWeight => ({
  tag,
  fraud: 0,
  legit: 0,
  weight,
  trusted,
});

describe("LearnedScorer", () => {
  it("uses the learned weight for a trusted tag", async () => {
    const model = mock<ModelPort>();
    model.weightFor.mockResolvedValue(learned("velocity", 40, true));
    const scorer = new LearnedScorer(model);

    const hits: RuleHit[] = [{ ruleId: "a", tag: "velocity", weight: 10 }];
    const s = await scorer.score(hits, features);

    expect(s.value).toBe(40);
    expect(s.model).toBe("learned@v1");
  });

  it("falls back to the hand weight for an untrusted tag", async () => {
    const model = mock<ModelPort>();
    model.weightFor.mockResolvedValue(learned("velocity", 40, false));
    const scorer = new LearnedScorer(model);

    const hits: RuleHit[] = [{ ruleId: "a", tag: "velocity", weight: 12 }];
    expect((await scorer.score(hits, features)).value).toBe(12);
  });

  it("falls back to the hand weight for an unlearned tag", async () => {
    const model = mock<ModelPort>();
    model.weightFor.mockResolvedValue(null);
    const scorer = new LearnedScorer(model);

    const hits: RuleHit[] = [{ ruleId: "a", tag: "new", weight: 20 }];
    expect((await scorer.score(hits, features)).value).toBe(20);
  });

  it("counts a learned tag once even when several rules raise it", async () => {
    const model = mock<ModelPort>();
    model.weightFor.mockResolvedValue(learned("velocity", 30, true));
    const scorer = new LearnedScorer(model);

    const hits: RuleHit[] = [
      { ruleId: "a", tag: "velocity", weight: 10 },
      { ruleId: "b", tag: "velocity", weight: 10 },
    ];
    expect((await scorer.score(hits, features)).value).toBe(30);
  });

  it("clamps the summed score to 100", async () => {
    const model = mock<ModelPort>();
    model.weightFor.mockImplementation(async (tag) => learned(tag, 60, true));
    const scorer = new LearnedScorer(model);

    const hits: RuleHit[] = [
      { ruleId: "a", tag: "x", weight: 1 },
      { ruleId: "b", tag: "y", weight: 1 },
    ];
    expect((await scorer.score(hits, features)).value).toBe(100);
  });
});
