import type { EventId, PolicyId, VerdictId } from "@shared/domain/ids";

/**
 * `challenge` (v0.4) means step-up authentication (3DS / OTP) before proceeding.
 * Adding it stayed additive — callers that only handle allow/review/deny keep compiling.
 */
export type Verdict = "allow" | "challenge" | "review" | "deny";

/**
 * The immutable record of one verdict — what the API returns and the append-only log stores.
 * A review verdict's case is owned by the Cases context and linked by this `id`
 * (verdictId), not fabricated here — Decision never mints a case id it can't guarantee.
 */
export interface Decision {
  readonly id: VerdictId;
  readonly eventId: EventId;
  readonly verdict: Verdict;
  readonly score: number;
  readonly reasons: ReadonlyArray<{ tag: string; points: number }>;
  readonly policyId: PolicyId;
  readonly policyVersion: string;
  readonly decidedAt: string;
}
