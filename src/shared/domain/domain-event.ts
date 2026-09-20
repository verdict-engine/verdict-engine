/**
 * The one shape every cross-context message takes. `name` is a stable string contract —
 * renaming one is breaking, so new facts get new names and payloads only grow additively.
 */
export interface DomainEvent<TPayload = unknown> {
  /** Stable, versioned contract name, e.g. "verdict.reached.v1". */
  readonly name: string;
  /** Unique per emission — consumers dedupe on it. */
  readonly id: string;
  /** When it happened (from the Clock port, never `new Date()` in domain code). */
  readonly occurredAt: string;
  /** Correlation id threaded from the originating request for tracing/replay. */
  readonly correlationId: string;
  readonly payload: TPayload;
}

/** Helper contexts use to stamp an event without re-deriving the envelope. */
export type EventFactory = <T>(
  name: string,
  correlationId: string,
  payload: T,
) => DomainEvent<T>;
