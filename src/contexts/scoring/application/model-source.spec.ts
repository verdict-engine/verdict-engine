import { describe, expect, it } from "vitest";
import type { FeatureSnapshot } from "@contexts/feature-store/application/feature-store.port";
import { ML_FEATURE_NAMES, type MlModel, validateModel } from "../domain/ml-features";
import { MlScorer } from "./ml-scorer.service";
import type { ModelSource } from "./model-source.port";

const cleanSnapshot: FeatureSnapshot = {
  velocity: { attemptsLast2m: 0, attemptsLast24h: 0, amountLast1h: 0 },
  device: { firstSeen: false, usersOnDevice: 0, fingerprintFirstSeen: false, usersOnFingerprint: 0, fingerprintDeviceMismatch: false },
  geo: { ipSimMismatch: false, impossibleTravel: false, countryChanged: false },
};

const modelWith = (bias: number): MlModel => ({
  weights: ML_FEATURE_NAMES.map(() => 0),
  bias,
  featureNames: [...ML_FEATURE_NAMES],
  trainedAt: "2099-01-01",
  metrics: { auc: 0.9, accuracy: 0.9, samples: 1 },
});

const source = (model: MlModel | null, kind = "remote"): ModelSource => ({ kind, load: async () => model });

describe("validateModel", () => {
  it("accepts a model whose feature names and order match the engine", () => {
    expect(validateModel(modelWith(-3))).not.toBeNull();
  });

  it("rejects a model with a different feature set, wrong length, or a non-finite weight", () => {
    expect(validateModel({ ...modelWith(-3), featureNames: ["a", "b"] })).toBeNull();
    expect(validateModel({ ...modelWith(-3), weights: [1, 2, 3] })).toBeNull();
    const bad = modelWith(-3);
    expect(validateModel({ ...bad, weights: bad.weights.map((_, i) => (i === 0 ? Number.NaN : 0)) })).toBeNull();
    expect(validateModel(null)).toBeNull();
    expect(validateModel({ weights: [], bias: "x" })).toBeNull();
  });
});

describe("MlScorer hot-swap", () => {
  it("serves a validated model loaded from the source", async () => {
    const scorer = new MlScorer(source(modelWith(20))); // all-zero weights + big bias ⇒ sigmoid≈1
    await scorer.onModuleInit();
    const r = await scorer.score([], cleanSnapshot);
    expect(r.value).toBe(100);
    expect(r.model).toBe("logreg@2099-01-01");
  });

  it("falls back to the bundled weights when the source returns null", async () => {
    const scorer = new MlScorer(source(null));
    await scorer.onModuleInit();
    const r = await scorer.score([], cleanSnapshot);
    expect(r.value).toBeLessThan(20); // bundled model on a clean event
  });
});
