import type { CaseId } from "@shared/domain/ids";
import type { FraudCase, ResolutionOutcome } from "../domain/fraud-case";

export type { FraudCase, ResolutionOutcome } from "../domain/fraud-case";

export interface ResolveInput {
  readonly outcome: ResolutionOutcome;
  readonly analyst: string;
  readonly note?: string;
}

/**
 * The analyst-facing operations on the review queue. Resolving a case is what
 * closes the feedback loop — it emits a label the scorer and rules learn from.
 */
export interface CasesPort {
  listQueue(queue: string): Promise<FraudCase[]>;
  get(id: CaseId): Promise<FraudCase | null>;
  assign(id: CaseId, analyst: string): Promise<FraudCase>;
  resolve(id: CaseId, input: ResolveInput): Promise<FraudCase>;
}

export const CASES_PORT = Symbol("CasesPort");
