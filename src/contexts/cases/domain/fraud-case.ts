import type { CaseId } from "@shared/domain/ids";
import { DomainError } from "@shared/domain/result";

export type CaseStatus = "open" | "assigned" | "resolved";
export type ResolutionOutcome = "fraud" | "legit" | "inconclusive";

export interface AuditEntry {
  readonly action: "opened" | "assigned" | "resolved";
  readonly at: string;
  readonly actor: string;
  readonly detail?: string;
}

export interface Resolution {
  readonly outcome: ResolutionOutcome;
  readonly analyst: string;
  readonly note?: string;
  readonly at: string;
}

export interface FraudCase {
  readonly id: CaseId;
  readonly eventId: string;
  readonly verdictId: string;
  readonly queue: string;
  readonly verdict: string;
  readonly score: number;
  readonly status: CaseStatus;
  readonly assignedTo?: string;
  readonly resolution?: Resolution;
  readonly openedAt: string;
  readonly audit: ReadonlyArray<AuditEntry>;
}

export function assignCase(c: FraudCase, analyst: string, at: string): FraudCase {
  if (c.status === "resolved") {
    throw new DomainError("CASE_RESOLVED", `case ${c.id} is already resolved`);
  }
  return {
    ...c,
    status: "assigned",
    assignedTo: analyst,
    audit: [...c.audit, { action: "assigned", at, actor: analyst }],
  };
}

export function resolveCase(
  c: FraudCase,
  outcome: ResolutionOutcome,
  analyst: string,
  at: string,
  note?: string,
): FraudCase {
  if (c.status === "resolved") {
    throw new DomainError("CASE_RESOLVED", `case ${c.id} is already resolved`);
  }
  return {
    ...c,
    status: "resolved",
    resolution: { outcome, analyst, note, at },
    audit: [...c.audit, { action: "resolved", at, actor: analyst, detail: outcome }],
  };
}
