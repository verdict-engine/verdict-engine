export type ScorerName = "weighted" | "learned";

/** SCORER=learned opts into the adaptive model; anything else keeps the hand weights. */
export function activeScorer(): ScorerName {
  return process.env.SCORER === "learned" ? "learned" : "weighted";
}
