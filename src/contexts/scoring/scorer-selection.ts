export type ScorerName = "weighted" | "learned" | "ml";

/**
 * SCORER picks the scoring engine: `ml` (trained logistic-regression model), `learned` (the adaptive
 * label-driven model), or the default hand `weighted` rules. All implement the same ScorerPort.
 */
export function activeScorer(): ScorerName {
  const v = process.env.SCORER;
  if (v === "ml") return "ml";
  if (v === "learned") return "learned";
  return "weighted";
}
