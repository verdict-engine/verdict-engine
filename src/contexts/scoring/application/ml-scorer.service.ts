import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { causeMessage, logEvent } from "@shared/observability/log";
import { modelReloadTotal, modelRemoteActive } from "@shared/observability/metrics";
import type { FeatureSnapshot } from "@contexts/feature-store/application/feature-store.port";
import type { RuleHit } from "@contexts/rules/application/rules-engine.port";
import { MODEL } from "../../../config/model";
import { type MlModel, mlFeatureVector, sigmoid } from "../domain/ml-features";
import { ML_WEIGHTS } from "../model/ml-weights";
import { MODEL_SOURCE, type ModelSource } from "./model-source.port";
import type { RiskScore, ScorerPort } from "./scorer.port";

const MAX_REASONS = 6;

/**
 * ML risk scorer: a logistic-regression model. Inference is a single dot-product over the scaled
 * feature vector plus a sigmoid — O(features), no I/O, no external model server — so it costs the
 * decision path nothing. The probability becomes the 0–100 score and the per-feature terms become the
 * explainable contributions. Enabled with SCORER=ml.
 *
 * The weights are hot-swappable: they load from the configured ModelSource at boot (and, if
 * MODEL_REFRESH_MINUTES is set, on a timer), so a retrained model can roll out from a cloud bucket
 * without a redeploy. Loading happens off the request path and never blocks scoring — until a load
 * succeeds, and after any failure, the bundled weights keep serving.
 */
@Injectable()
export class MlScorer implements ScorerPort, OnModuleInit, OnModuleDestroy {
  private model: MlModel = ML_WEIGHTS;
  private timer?: ReturnType<typeof setInterval>;

  constructor(@Inject(MODEL_SOURCE) private readonly source: ModelSource) {}

  async onModuleInit(): Promise<void> {
    await this.reload();
    // Loud warning when SCORER=ml is serving the bundled weights: they are a DEMONSTRATION model
    // trained on synthetic data, not a validated fraud model. (Also fires if a configured source failed
    // to load and we fell back to the bundled weights.)
    if (this.model === ML_WEIGHTS) {
      logEvent("warn", "model.synthetic_demo", {
        message:
          "SCORER=ml is serving the bundled DEMONSTRATION model trained on synthetic data — not a validated fraud model. Supply real weights via MODEL_PATH / MODEL_URL / MODEL_S3_* before production use.",
      });
    }
    if (MODEL.refreshMinutes > 0 && process.env.VITEST !== "true" && process.env.NODE_ENV !== "test") {
      this.timer = setInterval(() => void this.reload(), MODEL.refreshMinutes * 60_000);
      this.timer.unref?.();
    }
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /** Load from the source; keep the current model on failure so scoring is never interrupted. */
  private async reload(): Promise<void> {
    try {
      const loaded = await this.source.load();
      if (loaded) {
        this.model = loaded;
        modelReloadTotal.inc({ result: "loaded" });
        modelRemoteActive.set(this.source.kind === "remote" ? 1 : 0);
        logEvent("info", "model.active", { source: this.source.kind, trainedAt: loaded.trainedAt });
        return;
      }
      modelReloadTotal.inc({ result: "fallback" });
      if (this.source.kind === "remote") modelRemoteActive.set(0);
    } catch (cause) {
      modelReloadTotal.inc({ result: "fallback" });
      logEvent("error", "model.reload_failed", { cause: causeMessage(cause) });
    }
  }

  /** The model currently serving, plus where it came from — for the admin model view. */
  describe(): { model: MlModel; source: string } {
    return { model: this.model, source: this.source.kind };
  }

  async score(hits: RuleHit[], features: FeatureSnapshot): Promise<RiskScore> {
    const model = this.model;
    const x = mlFeatureVector(hits, features);
    const terms = x.map((xi, i) => xi * model.weights[i]);
    const p = sigmoid(model.bias + terms.reduce((s, t) => s + t, 0));
    const value = Math.round(p * 100);

    // Attribute the score to the features that pushed it up, proportional to their positive logit share.
    const positive = terms
      .map((t, i) => ({ tag: `ml:${model.featureNames[i]}`, term: t }))
      .filter((c) => c.term > 0)
      .sort((a, b) => b.term - a.term)
      .slice(0, MAX_REASONS);
    const totalPos = positive.reduce((s, c) => s + c.term, 0);
    const contributions = totalPos > 0
      ? positive.map((c) => ({ tag: c.tag, points: Math.round((c.term / totalPos) * value) }))
      : [];

    return { value, contributions, model: `logreg@${model.trainedAt}` };
  }
}
