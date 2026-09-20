/**
 * A per-entity running distribution, updated online with Welford's algorithm so a
 * baseline is maintained in O(1) per event — no window to store or replay. `m2` is the
 * running sum of squared deviations from which variance falls out.
 */
export interface Stats {
  readonly count: number;
  readonly mean: number;
  readonly m2: number;
}

/** Below this many observations there's no baseline to judge against. */
const MIN_SAMPLES = 3;

export const emptyStats = (): Stats => ({ count: 0, mean: 0, m2: 0 });

export function observe(s: Stats, x: number): Stats {
  const count = s.count + 1;
  const delta = x - s.mean;
  const mean = s.mean + delta / count;
  const m2 = s.m2 + delta * (x - mean);
  return { count, mean, m2 };
}

export function stddev(s: Stats): number {
  return s.count < 2 ? 0 : Math.sqrt(s.m2 / (s.count - 1));
}

/**
 * How many standard deviations `x` sits from the baseline mean. Returns 0 when there's
 * too little history or no variance — an unknown baseline is never treated as anomalous.
 */
export function zScore(s: Stats, x: number): number {
  if (s.count < MIN_SAMPLES) return 0;
  const sd = stddev(s);
  if (sd === 0) return 0;
  return (x - s.mean) / sd;
}
