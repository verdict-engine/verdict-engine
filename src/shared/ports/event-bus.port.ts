import type { DomainEvent } from "../domain/domain-event";

/**
 * EventBus — the asynchronous seam between contexts. Swapping the in-process adapter
 * for a Kafka/BullMQ one turns a context into a service; publishers and subscribers
 * below do not change one line.
 */
export interface EventBus {
  publish(event: DomainEvent): Promise<void>;
  subscribe<T>(
    eventName: string,
    handler: (event: DomainEvent<T>) => Promise<void>,
  ): void;
}

/** DI token — ports are bound to adapters only at the composition root. */
export const EVENT_BUS = Symbol("EventBus");
