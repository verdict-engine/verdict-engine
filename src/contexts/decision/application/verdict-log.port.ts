import type { TxContext } from "@shared/ports/store.port";
import type { Decision } from "../domain/verdict";

/**
 * Append-only — decisions are events, never updated or deleted (the adapter may only INSERT).
 * Replaying the log reconstructs why any verdict was reached and backtests a rule change against real history.
 * `append` takes an optional transaction so the verdict commits atomically with the outbox event.
 */
export interface VerdictLogPort {
  append(decision: Decision, tx?: TxContext): Promise<void>;
  recent(limit: number): Promise<Decision[]>;
}

export const VERDICT_LOG_PORT = Symbol("VerdictLogPort");
