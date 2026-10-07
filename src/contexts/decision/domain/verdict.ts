import type { EventId, PolicyId, VerdictId } from "@shared/domain/ids";
import type { ReasonCode } from "./reason-codes";

/**
 * `challenge` (v0.4) means step-up authentication (3DS / OTP) before proceeding.
 * Adding it stayed additive — callers that only handle allow/review/deny keep compiling.
 */
export type Verdict = "allow" | "challenge" | "review" | "deny";

/**
 * How a decision was applied. `enforce` (default) is a live decision the caller acts on; `shadow`
 * scores live traffic without acting — the verdict is logged for comparison but triggers no
 * enforcement side effects (no webhook/notification fan-out, no review case).
 */
export type DecisionMode = "enforce" | "shadow";

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
  /** Internal / analyst layer: the rule tags that fired and their points. Never shown to a customer. */
  readonly reasons: ReadonlyArray<{ tag: string; points: number }>;
  /** Merchant / dispute layer: stable, documented codes derived from the reasons (see reason-codes.ts). */
  readonly reasonCodes?: ReadonlyArray<ReasonCode>;
  /** End-customer layer: one vague, verdict-level line safe to show the cardholder. */
  readonly customerMessage?: string;
  readonly policyId: PolicyId;
  readonly policyVersion: string;
  readonly decidedAt: string;
  /** True when produced in shadow mode — logged for comparison, not enforced. Absent = enforced. */
  readonly shadow?: boolean;
}
