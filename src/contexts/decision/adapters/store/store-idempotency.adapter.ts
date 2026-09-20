import { Inject, Injectable } from "@nestjs/common";
import { STORE, type Store, type TxContext } from "@shared/ports/store.port";
import type { Decision } from "../../domain/verdict";
import type { IdempotencyStore } from "../../application/idempotency.port";

interface Record {
  decision: Decision;
  /** Top-level copy of the decision time so the retention job can age idempotency keys out by a
   * single indexed field (the decision itself is nested). */
  claimedAt: string;
}

const COLLECTION = "idempotency";

/**
 * Durable, transactional idempotency. The record lives in the same store as the verdict and is
 * claimed with an atomic insert-if-absent inside the decision's transaction, so it commits together
 * with the verdict and outbox event. (Records accumulate; age them out with a retention window, like
 * the verdict log.)
 */
@Injectable()
export class StoreIdempotency implements IdempotencyStore {
  constructor(@Inject(STORE) private readonly store: Store) {}

  async get(key: string): Promise<Decision | undefined> {
    const row = await this.store.collection<Record>(COLLECTION).get(key);
    return row?.decision;
  }

  async claim(tx: TxContext, key: string, decision: Decision): Promise<Decision | null> {
    const col = tx.collection<Record>(COLLECTION);
    const won = await col.putIfAbsent(key, { decision, claimedAt: decision.decidedAt });
    if (won) return null;
    const existing = await col.get(key);
    return existing?.decision ?? decision;
  }
}
