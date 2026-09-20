import type { DomainEvent } from "@shared/domain/domain-event";
import type { TxContext } from "@shared/ports/store.port";

/**
 * Transactional outbox. `enqueue` stages the event durably as part of the decision's commit
 * (pass the commit's `tx` so it lands in the same transaction as the verdict); a separate relay
 * delivers it to the bus with retry/backoff and a dead-letter. Delivery failures are the relay's
 * problem, never the request's — so a flaky bus can't turn a committed verdict into an error.
 */
export interface OutboxPort {
  enqueue(event: DomainEvent, tx?: TxContext): Promise<void>;
  /** Best-effort, non-blocking nudge to deliver pending events now (called right after commit). */
  flush(): void;
}

export const OUTBOX_PORT = Symbol("OutboxPort");
