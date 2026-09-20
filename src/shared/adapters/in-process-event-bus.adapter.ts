import { Injectable } from "@nestjs/common";
import type { DomainEvent } from "../domain/domain-event";
import type { EventBus } from "../ports/event-bus.port";

/**
 * Default EventBus adapter: in-memory, in-process fan-out. To move a subscriber into
 * its own service, replace this class with a Kafka/BullMQ adapter and rebind the token —
 * no publisher or subscriber changes.
 */
@Injectable()
export class InProcessEventBus implements EventBus {
  private readonly handlers = new Map<
    string,
    Array<(event: DomainEvent) => Promise<void>>
  >();

  async publish(event: DomainEvent): Promise<void> {
    const subscribers = this.handlers.get(event.name) ?? [];
    // TODO: run outside the request's critical path (microtask/queue) and
    //       isolate failures so one slow subscriber never blocks a decision.
    await Promise.all(subscribers.map((h) => h(event)));
  }

  subscribe<T>(
    eventName: string,
    handler: (event: DomainEvent<T>) => Promise<void>,
  ): void {
    const list = this.handlers.get(eventName) ?? [];
    list.push(handler as (event: DomainEvent) => Promise<void>);
    this.handlers.set(eventName, list);
  }
}
