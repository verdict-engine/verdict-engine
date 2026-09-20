import type { Verdict } from "./verdict";

export type Label = "fraud" | "legit";

/**
 * Backtesting scores with the transparent weighted sum on purpose: it holds the scoring
 * method fixed so the result isolates the effect of the rule/policy change under test,
 * and stays deterministic regardless of which scorer is live.
 */
export function weightedScore(hits: ReadonlyArray<{ tag: string; weight: number }>): number {
  const byTag = new Map<string, number>();
  for (const h of hits) byTag.set(h.tag, (byTag.get(h.tag) ?? 0) + h.weight);
  const raw = [...byTag.values()].reduce((sum, w) => sum + w, 0);
  return Math.max(0, Math.min(100, raw));
}

/** Any verdict other than `allow` is an intervention — a flag on the transaction. */
export const isFlagged = (v: Verdict): boolean => v !== "allow";

export interface BacktestRow {
  candidate: Verdict;
  actual: Verdict;
  label: Label;
}

export interface Confusion {
  truePositives: number;
  falsePositives: number;
  falseNegatives: number;
  trueNegatives: number;
}

export interface BacktestResult {
  labeled: number;
  candidate: Confusion & { precision: number; recall: number; falsePositiveRate: number };
  baseline: Confusion;
  delta: { fraudCaught: number; falsePositives: number; flips: number };
}

function confusionOf(rows: readonly BacktestRow[], pick: (r: BacktestRow) => Verdict): Confusion {
  const c: Confusion = { truePositives: 0, falsePositives: 0, falseNegatives: 0, trueNegatives: 0 };
  for (const r of rows) {
    const flagged = isFlagged(pick(r));
    const fraud = r.label === "fraud";
    if (flagged && fraud) c.truePositives += 1;
    else if (flagged && !fraud) c.falsePositives += 1;
    else if (!flagged && fraud) c.falseNegatives += 1;
    else c.trueNegatives += 1;
  }
  return c;
}

const ratio = (num: number, den: number): number => (den === 0 ? 0 : num / den);

export function computeBacktest(rows: readonly BacktestRow[]): BacktestResult {
  const candidate = confusionOf(rows, (r) => r.candidate);
  const baseline = confusionOf(rows, (r) => r.actual);
  return {
    labeled: rows.length,
    candidate: {
      ...candidate,
      precision: ratio(candidate.truePositives, candidate.truePositives + candidate.falsePositives),
      recall: ratio(candidate.truePositives, candidate.truePositives + candidate.falseNegatives),
      falsePositiveRate: ratio(candidate.falsePositives, candidate.falsePositives + candidate.trueNegatives),
    },
    baseline,
    delta: {
      fraudCaught: candidate.truePositives - baseline.truePositives,
      falsePositives: candidate.falsePositives - baseline.falsePositives,
      flips: rows.filter((r) => r.candidate !== r.actual).length,
    },
  };
}
