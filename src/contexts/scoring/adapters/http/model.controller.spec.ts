import { describe, expect, it } from "vitest";
import { mock } from "vitest-mock-extended";
import type { ModelPort } from "../../application/model.port";
import type { ScorerPort } from "../../application/scorer.port";
import { ML_FEATURE_NAMES } from "../../domain/ml-features";
import { ModelController } from "./model.controller";

describe("ModelController.scoringModel", () => {
  it("reports the active scorer and the bundled ML model with per-feature weights", () => {
    // No SCORER env in tests → activeScorer() defaults to "weighted"; the ml block reflects the bundled weights.
    const controller = new ModelController(mock<ModelPort>(), mock<ScorerPort>());
    const res = controller.scoringModel();

    expect(res.scorer).toBe("weighted");
    expect(res.ml.active).toBe(false);
    expect(res.ml.source).toBe("bundled");
    expect(res.ml.features).toHaveLength(ML_FEATURE_NAMES.length);
    expect(res.ml.features.map((f) => f.name)).toEqual([...ML_FEATURE_NAMES]);
    expect(res.ml.metrics.auc).toBeGreaterThan(0.5);
    expect(res.ml.features.every((f) => typeof f.weight === "number")).toBe(true);
  });
});
