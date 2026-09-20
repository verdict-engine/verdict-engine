import type { TxContext } from "@shared/ports/store.port";
import type { SanitizedRequest } from "../domain/sanitize";
import type { Verdict } from "../domain/verdict";

/**
 * The API interaction log: one entry per scored request, pairing the (masked, compliant)
 * request payload with the verdict it produced. Append-only like the verdict log, but it also
 * keeps the request so operators can audit exactly what was sent and what came back. Personal
 * data is masked at write time (see sanitizeRequest); entries are still erasable by subject.
 */
export interface ActivityEntry {
  readonly id: string;
  readonly eventId: string;
  readonly eventType: string;
  readonly request: SanitizedRequest;
  readonly verdict: Verdict;
  readonly score: number;
  readonly reasons: ReadonlyArray<{ readonly tag: string; readonly points: number }>;
  readonly policyId: string;
  readonly policyVersion: string;
  readonly decidedAt: string;
}

export interface ActivityLogPort {
  append(entry: ActivityEntry, tx?: TxContext): Promise<void>;
  recent(limit: number): Promise<ActivityEntry[]>;
  /** Right-to-erasure: drop every entry for a user; returns the count removed. */
  eraseSubject(userId: string): Promise<number>;
}

export const ACTIVITY_LOG_PORT = Symbol("ActivityLogPort");
