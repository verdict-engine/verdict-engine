import { Inject, Injectable } from "@nestjs/common";
import type { FeatureSnapshot } from "@contexts/feature-store/application/feature-store.port";
import type { RuleHit } from "@contexts/rules/application/rules-engine.port";
import { MODEL_PORT, type ModelPort } from "./model.port";
import type { RiskScore, ScorerPort } from "./scorer.port";

const MODEL = "learned@v1";

/**
 * Same ScorerPort as WeightedScorer, but each tag's points come from how predictive
 * that tag has been of fraud in resolved cases. A tag without enough labels falls back
 * to its hand weight, so a fresh deployment behaves exactly like the weighted scorer
 * and drifts toward the data as labels accumulate.
 */
@Injectable()
export class LearnedScorer implements ScorerPort {
  constructor(@Inject(MODEL_PORT) private readonly model: ModelPort) {}

  async score(hits: RuleHit[], _features: FeatureSnapshot): Promise<RiskScore> {
    const handWeightByTag = new Map<string, number>();
    for (const hit of hits) {
      handWeightByTag.set(hit.tag, (handWeightByTag.get(hit.tag) ?? 0) + hit.weight);
    }

    const contributions: Array<{ tag: string; points: number }> = [];
    for (const [tag, handWeight] of handWeightByTag) {
      const learned = await this.model.weightFor(tag);
      contributions.push({ tag, points: learned?.trusted ? learned.weight : handWeight });
    }
    contributions.sort((a, b) => b.points - a.points);

    const raw = contributions.reduce((sum, c) => sum + c.points, 0);
    return { value: clamp(raw, 0, 100), contributions, model: MODEL };
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
