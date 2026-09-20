import type { FeatureSnapshot } from "@contexts/feature-store/application/feature-store.port";
import type { RuleHit } from "@contexts/rules/application/rules-engine.port";

/**
 * RiskScore — a 0–100 number plus the reasons behind it. The `contributions`
 * are what make a verdict explainable: every point is attributable to a rule.
 */
export interface RiskScore {
  readonly value: number; // 0..100
  readonly contributions: ReadonlyArray<{ tag: string; points: number }>;
  readonly model: string; // e.g. "weighted@v0.4" or "gbm@2026-09"
}

/**
 * The seam that lets today's hand-weighted scorer become a trained model with zero
 * change upstream — Decision depends on THIS, not on how the number is produced.
 */
export interface ScorerPort {
  score(hits: RuleHit[], features: FeatureSnapshot): Promise<RiskScore>;
}

export const SCORER_PORT = Symbol("ScorerPort");
