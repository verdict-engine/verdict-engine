/**
 * The compiled shape of one line of the Rule DSL (authored in text, versioned in git).
 * A matched rule contributes a RuleHit, never a verdict: Rules propose, Scoring weighs,
 * Decision decides — that separation is what keeps the engine auditable.
 */
export interface Rule {
  readonly id: string;
  readonly name: string;
  readonly condition: Condition;
  readonly weight: number;
  readonly tag: string;
}

/** A tree of comparisons over the RiskEvent + FeatureSnapshot namespaces. */
export type Condition =
  | { readonly kind: "compare"; readonly path: string; readonly op: CompareOp; readonly value: number | string | boolean }
  | { readonly kind: "and"; readonly all: Condition[] }
  | { readonly kind: "or"; readonly any: Condition[] };

export type CompareOp = "gt" | "gte" | "lt" | "lte" | "eq" | "neq";

export interface RuleHit {
  readonly ruleId: string;
  /** The rule's human name (e.g. `new_device_takeover`) — carried so a decision can be traced back to
   *  the exact rule that fired. Optional so hand-built hits (tests, fixtures) stay valid. */
  readonly name?: string;
  readonly tag: string;
  readonly weight: number;
}
