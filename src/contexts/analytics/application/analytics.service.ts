import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { EVENT_BUS, type EventBus } from "@shared/ports/event-bus.port";
import { STORE, type Collection, type Store } from "@shared/ports/store.port";
import { Mutex } from "@shared/domain/mutex";
import {
  VERDICT_REACHED,
  type VerdictReachedPayload,
} from "@contexts/decision/application/decision.contracts";
import {
  CASE_RESOLVED,
  type CaseResolvedPayload,
} from "@contexts/cases/application/case.contracts";
import {
  LABEL_RECORDED,
  type LabelRecordedPayload,
} from "@contexts/feedback/application/label.contracts";
import {
  applyLabel,
  applyResolution,
  applyVerdict,
  emptySummary,
  falsePositiveRate,
  type AnalyticsSummary,
} from "../domain/summary";
import type { AnalyticsPort, AnalyticsView } from "./analytics.port";

const DOC = "summary";

/**
 * A read-model projector: it maintains a rollup by consuming events, never by querying the
 * write side. The bus fans one event out to several handlers concurrently, and one event can
 * trigger another, so every fold runs through a mutex — otherwise the load/save gap on an
 * async store lets a concurrent update clobber this one.
 */
@Injectable()
export class AnalyticsService implements AnalyticsPort, OnModuleInit {
  private readonly summaries: Collection<AnalyticsSummary>;
  private readonly lock = new Mutex();

  constructor(
    @Inject(STORE) store: Store,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
  ) {
    this.summaries = store.collection<AnalyticsSummary>("analytics");
  }

  onModuleInit(): void {
    this.bus.subscribe<VerdictReachedPayload>(VERDICT_REACHED, (e) =>
      this.fold((s) => applyVerdict(s, e.payload, e.occurredAt)),
    );
    this.bus.subscribe<CaseResolvedPayload>(CASE_RESOLVED, (e) =>
      this.fold((s) => applyResolution(s, e.payload.outcome)),
    );
    this.bus.subscribe<LabelRecordedPayload>(LABEL_RECORDED, (e) =>
      this.fold((s) => applyLabel(s, e.payload)),
    );
  }

  private fold(apply: (s: AnalyticsSummary) => void): Promise<void> {
    return this.lock.run(async () => {
      const s = await this.load();
      apply(s);
      await this.summaries.put(DOC, s);
    });
  }

  async summary(): Promise<AnalyticsView> {
    const s = await this.load();
    return { ...s, falsePositiveRate: falsePositiveRate(s) };
  }

  private async load(): Promise<AnalyticsSummary> {
    return (await this.summaries.get(DOC)) ?? emptySummary();
  }
}
