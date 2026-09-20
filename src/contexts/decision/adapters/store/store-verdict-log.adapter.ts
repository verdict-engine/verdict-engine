import { Inject, Injectable } from "@nestjs/common";
import { STORE, type Store, type TxContext } from "@shared/ports/store.port";
import type { Decision } from "../../domain/verdict";
import type { VerdictLogPort } from "../../application/verdict-log.port";

const COLLECTION = "verdicts";

/** Append-only: only ever put, never update or delete. Durable via the Store. */
@Injectable()
export class StoreVerdictLog implements VerdictLogPort {
  constructor(@Inject(STORE) private readonly store: Store) {}

  async append(decision: Decision, tx?: TxContext): Promise<void> {
    await (tx ?? this.store).collection<Decision>(COLLECTION).put(decision.id, decision);
  }

  async recent(limit: number): Promise<Decision[]> {
    return (await this.store.collection<Decision>(COLLECTION).all())
      .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))
      .slice(0, limit);
  }
}
