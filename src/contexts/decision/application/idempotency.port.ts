import type { TxContext } from "@shared/ports/store.port";
import type { Decision } from "../domain/verdict";

/**
 * Makes /v1/decisions safe to retry — the same idempotency key (or event id) returns the SAME
 * decision instead of recomputing and re-logging. The record is claimed and written inside the
 * decision's transaction (see `claim`), so it commits atomically with the verdict and outbox event:
 * a crash after commit, or a concurrent duplicate, can never produce two verdicts/events for one key.
 */
export interface IdempotencyStore {
  /** Fast pre-check: the decision already recorded for this key, if any. */
  get(key: string): Promise<Decision | undefined>;
  /**
   * Atomically claim the key inside the caller's transaction, storing `decision` as the result.
   * Returns null if we won the claim (caller should finish the commit), or the already-committed
   * decision if another request got there first (caller must NOT write anything else).
   */
  claim(tx: TxContext, key: string, decision: Decision): Promise<Decision | null>;
}

export const IDEMPOTENCY_STORE = Symbol("IdempotencyStore");
