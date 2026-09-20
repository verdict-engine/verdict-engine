import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import type { DomainEvent } from "@shared/domain/domain-event";
import { CLOCK, type Clock } from "@shared/ports/clock.port";
import { EVENT_BUS, type EventBus } from "@shared/ports/event-bus.port";
import { ID_GENERATOR, type IdGenerator } from "@shared/ports/id-generator.port";
import {
  CASE_RESOLVED,
  type CaseResolvedPayload,
} from "@contexts/cases/application/case.contracts";
import { LABEL_RECORDED, type LabelRecordedPayload } from "../domain/events";
import { FEEDBACK_PORT, type FeedbackPort, type Label } from "./feedback.port";

/**
 * The one place a label is written, so both sources — analyst resolutions and PSP
 * chargebacks — persist and broadcast the same `label.recorded` fact. Everything that
 * learns from labels subscribes to that event, never to a specific source.
 */
@Injectable()
export class FeedbackService implements OnModuleInit {
  constructor(
    @Inject(FEEDBACK_PORT) private readonly feedback: FeedbackPort,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe<CaseResolvedPayload>(CASE_RESOLVED, async (e) => {
      // "inconclusive" is not ground truth — it produces no label.
      if (e.payload.outcome === "inconclusive") return;
      await this.record({
        eventId: e.payload.eventId,
        outcome: e.payload.outcome,
        source: "analyst",
        at: this.clock.isoNow(),
      });
    });
  }

  async record(label: Label): Promise<void> {
    await this.feedback.record(label);
    await this.bus.publish(
      this.event<LabelRecordedPayload>(LABEL_RECORDED, {
        eventId: label.eventId,
        outcome: label.outcome,
        source: label.source,
      }),
    );
  }

  private event<T>(name: string, payload: T): DomainEvent<T> {
    return {
      name,
      id: this.ids.next("evt"),
      occurredAt: this.clock.isoNow(),
      correlationId: this.ids.next("cor"),
      payload,
    };
  }
}
