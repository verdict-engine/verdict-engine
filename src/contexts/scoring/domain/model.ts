export interface TagCounts {
  readonly fraud: number;
  readonly legit: number;
}

export interface ModelDoc {
  readonly tags: Record<string, TagCounts>;
}

/** Points a fully-predictive tag can contribute; keeps a few strong signals shy of 100. */
const SCALE = 45;

/** Below this many labels a tag's rate is noise — the scorer keeps its hand weight instead. */
const MIN_SAMPLES = 3;

export const emptyModel = (): ModelDoc => ({ tags: {} });

export function recordLabel(
  model: ModelDoc,
  tags: readonly string[],
  outcome: "fraud" | "legit",
): ModelDoc {
  const next: Record<string, TagCounts> = { ...model.tags };
  for (const tag of tags) {
    const c = next[tag] ?? { fraud: 0, legit: 0 };
    next[tag] =
      outcome === "fraud"
        ? { fraud: c.fraud + 1, legit: c.legit }
        : { fraud: c.fraud, legit: c.legit + 1 };
  }
  return { tags: next };
}

/**
 * Laplace-smoothed fraud rate scaled to points. Smoothing pulls thin tags toward
 * an even prior so one label can't swing a weight to an extreme.
 */
export function weightOf(counts: TagCounts): { weight: number; trusted: boolean } {
  const total = counts.fraud + counts.legit;
  const fraudRate = (counts.fraud + 0.5) / (total + 1);
  return { weight: Math.round(fraudRate * SCALE), trusted: total >= MIN_SAMPLES };
}
