import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { CLOCK, type Clock } from "@shared/ports/clock.port";
import { ID_GENERATOR, type IdGenerator } from "@shared/ports/id-generator.port";
import { EVENT_BUS, type EventBus } from "@shared/ports/event-bus.port";
import type { DomainEvent } from "@shared/domain/domain-event";
import { DomainError } from "@shared/domain/result";
import type { CaseId } from "@shared/domain/ids";
import {
  VERDICT_REACHED,
  type VerdictReachedPayload,
} from "@contexts/decision/application/decision.contracts";
import { assignCase, resolveCase, type FraudCase } from "../domain/fraud-case";
import { CASE_RESOLVED, type CaseResolvedPayload } from "../domain/events";
import type { CasesPort, ResolveInput } from "./cases.port";
import {
  CASE_REPOSITORY_PORT,
  type CaseRepositoryPort,
} from "./case-repository.port";

@Injectable()
export class CaseService implements CasesPort, OnModuleInit {
  constructor(
    @Inject(CASE_REPOSITORY_PORT) private readonly cases: CaseRepositoryPort,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    this.bus.subscribe<VerdictReachedPayload>(VERDICT_REACHED, async (e) => {
      if (e.payload.verdict === "review") await this.open(e.payload);
    });
  }

  listQueue(queue: string): Promise<FraudCase[]> {
    return this.cases.listByQueue(queue);
  }

  get(id: CaseId): Promise<FraudCase | null> {
    return this.cases.get(id);
  }

  async assign(id: CaseId, analyst: string): Promise<FraudCase> {
    const updated = assignCase(await this.require(id), analyst, this.clock.isoNow());
    await this.cases.save(updated);
    return updated;
  }

  async resolve(id: CaseId, input: ResolveInput): Promise<FraudCase> {
    const updated = resolveCase(
      await this.require(id),
      input.outcome,
      input.analyst,
      this.clock.isoNow(),
      input.note,
    );
    await this.cases.save(updated);
    // An analyst's verdict is ground truth — broadcast it so Feedback records a label.
    await this.bus.publish(
      this.event<CaseResolvedPayload>(CASE_RESOLVED, {
        caseId: updated.id,
        eventId: updated.eventId,
        outcome: input.outcome,
        analyst: input.analyst,
      }),
    );
    return updated;
  }

  private async open(payload: VerdictReachedPayload): Promise<void> {
    const now = this.clock.isoNow();
    await this.cases.save({
      id: this.ids.next("cse") as CaseId,
      eventId: payload.eventId,
      verdictId: payload.verdictId,
      queue: payload.reviewQueue ?? "default",
      verdict: payload.verdict,
      score: payload.score,
      status: "open",
      openedAt: now,
      audit: [{ action: "opened", at: now, actor: "system" }],
    });
  }

  private async require(id: CaseId): Promise<FraudCase> {
    const found = await this.cases.get(id);
    if (!found) throw new DomainError("CASE_NOT_FOUND", `case ${id} not found`);
    return found;
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
