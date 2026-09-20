import type { FeatureSnapshot } from "@contexts/feature-store/application/feature-store.port";
import type { RiskEvent } from "@contexts/ingest/application/ingest.port";
import type { Rule, RuleHit } from "../domain/rule";

/** Rules' published contract: consumers (Scoring) import RuleHit from here. */
export type { RuleHit } from "../domain/rule";

/**
 * RulesEnginePort — the synchronous contract the Decision orchestrator calls on the
 * request path. Pure (event, features) → hits, no I/O beyond loading the ruleset.
 * `evaluateRuleset` runs a caller-supplied ruleset instead of the active one — the seam
 * backtesting uses to replay a candidate rule change over the stored history.
 */
export interface RulesEnginePort {
  evaluate(event: RiskEvent, features: FeatureSnapshot): Promise<RuleHit[]>;
  evaluateRuleset(rules: readonly Rule[], event: RiskEvent, features: FeatureSnapshot): RuleHit[];
}

export const RULES_ENGINE_PORT = Symbol("RulesEnginePort");
