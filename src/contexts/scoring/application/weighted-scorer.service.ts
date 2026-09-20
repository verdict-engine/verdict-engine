import { Injectable } from "@nestjs/common";
import type { FeatureSnapshot } from "@contexts/feature-store/application/feature-store.port";
import type { RuleHit } from "@contexts/rules/application/rules-engine.port";
import type { RiskScore, ScorerPort } from "./scorer.port";

const MODEL = "weighted@v0.4";

/**
 * Deliberately transparent — every point stays attributable to a tag; the ML
 * adapter implements the same ScorerPort when you outgrow hand weights.
 *
 * This scorer weighs rule hits only; features reach the score indirectly, through
 * the rule conditions that read them. `features` is in the signature for the ML
 * adapter, which will consume the raw snapshot directly.
 */
@Injectable()
export class WeightedScorer implements ScorerPort {
  async score(hits: RuleHit[], _features: FeatureSnapshot): Promise<RiskScore> {
    const byTag = new Map<string, number>();
    for (const hit of hits) {
      byTag.set(hit.tag, (byTag.get(hit.tag) ?? 0) + hit.weight);
    }
    const contributions = [...byTag.entries()]
      .map(([tag, points]) => ({ tag, points }))
      .sort((a, b) => b.points - a.points);

    const raw = contributions.reduce((sum, c) => sum + c.points, 0);
    return { value: clamp(raw, 0, 100), contributions, model: MODEL };
  }
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}
