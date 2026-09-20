import type { DomainEvent } from "@shared/domain/domain-event";

/** How a staged event is persisted while it waits for the relay to deliver it. */
export interface OutboxRow {
  readonly event: DomainEvent;
  status: "pending" | "dead";
  attempts: number;
  /** ISO — the relay skips a row until now() >= this (exponential backoff between tries). */
  nextAttemptAt: string;
  lastError?: string;
  readonly createdAt: string;
}

export const OUTBOX_COLLECTION = "outbox";
export const OUTBOX_DLQ_COLLECTION = "outbox_dead";
/** Per-row leases so multiple relay replicas don't process the same row concurrently. */
export const OUTBOX_LOCK_COLLECTION = "outbox_locks";
