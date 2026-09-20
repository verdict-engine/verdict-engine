import type { PolicyId } from "@shared/domain/ids";
import type { RiskScore } from "@contexts/scoring/application/scorer.port";
import type { Verdict } from "./verdict";

/**
 * Policy — the pure function from a score to a verdict, expressed as versioned bands.
 * `onError` is the load-bearing safety switch: on a degraded dependency the engine falls to this outcome ON PURPOSE, never silently blocking or waving traffic through.
 */
export interface Policy {
  readonly id: PolicyId;
  readonly version: string;
  readonly bands: ReadonlyArray<Band>;
  readonly onError: "fail_open" | "fail_closed";
}

export interface Band {
  readonly verdict: Verdict;
  readonly min: number;
  readonly max: number;
  readonly reviewQueue?: string;
}

const VERDICTS: ReadonlySet<string> = new Set<Verdict>(["allow", "challenge", "review", "deny"]);

/**
 * Validates a policy before it's published — bands must cover 0–100 contiguously with
 * no gaps or overlaps, so `resolveVerdict` can never fall through. Returns an error
 * message, or null when valid.
 */
export function validatePolicy(policy: Policy): string | null {
  if (!policy.version.trim()) return "version is required";
  if (policy.onError !== "fail_open" && policy.onError !== "fail_closed") return "onError must be fail_open or fail_closed";
  if (policy.bands.length === 0) return "at least one band is required";

  const bands = [...policy.bands].sort((a, b) => a.min - b.min);
  if (bands[0].min !== 0) return "bands must start at 0";
  if (bands[bands.length - 1].max !== 100) return "bands must end at 100";

  for (let i = 0; i < bands.length; i++) {
    const b = bands[i];
    if (!VERDICTS.has(b.verdict)) return `unknown verdict: ${b.verdict}`;
    if (b.min > b.max) return `band ${b.verdict} has min > max`;
    if (i > 0 && b.min !== bands[i - 1].max + 1) return `bands must be contiguous (gap before ${b.min})`;
  }
  return null;
}

/** Pure resolution — no I/O, so it is exhaustively unit-testable. */
export function resolveVerdict(policy: Policy, score: RiskScore): Band {
  const band = policy.bands.find(
    (b) => score.value >= b.min && score.value <= b.max,
  );
  if (!band) {
    throw new Error(
      `policy ${policy.id}@${policy.version} has a gap at score ${score.value}`,
    );
  }
  return band;
}
