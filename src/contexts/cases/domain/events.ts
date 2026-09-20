import type { DomainEvent } from "@shared/domain/domain-event";
import type { ResolutionOutcome } from "./fraud-case";

export const CASE_RESOLVED = "case.resolved.v1";

export interface CaseResolvedPayload {
  readonly caseId: string;
  readonly eventId: string;
  readonly outcome: ResolutionOutcome;
  readonly analyst: string;
}

export type CaseResolved = DomainEvent<CaseResolvedPayload>;
