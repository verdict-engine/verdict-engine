/**
 * Rules' published rule shape — so another context (backtesting) can hand a candidate
 * ruleset back to the engine to replay. Import these, never rules/domain.
 */
export type { Rule, Condition, CompareOp, RuleHit } from "../domain/rule";
