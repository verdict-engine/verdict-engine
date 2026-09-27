import { Inject, Injectable } from "@nestjs/common";
import type { DomainEvent } from "@shared/domain/domain-event";
import { CLOCK, type Clock } from "@shared/ports/clock.port";
import { ID_GENERATOR, type IdGenerator } from "@shared/ports/id-generator.port";
import { STORE, type Store } from "@shared/ports/store.port";
import { ALERT_SETTINGS, type AlertSettings } from "@shared/adapters/alert-settings";
import { ALERT_ANOMALY, type AnomalyAlertPayload } from "@shared/domain/alerts";
import { causeMessage, logEvent } from "@shared/observability/log";
import { decisionDuration, decisionsTotal, degradedTotal } from "@shared/observability/metrics";
import { type Result, ok } from "@shared/domain/result";
import type { VerdictId } from "@shared/domain/ids";
import type { RiskEvent } from "@contexts/ingest/application/ingest.port";
import {
  FEATURE_STORE_PORT,
  type FeatureStorePort,
} from "@contexts/feature-store/application/feature-store.port";
import {
  RULES_ENGINE_PORT,
  type RulesEnginePort,
} from "@contexts/rules/application/rules-engine.port";
import { GRAPH_PORT, type GraphPort } from "@contexts/graph/application/graph.port";
import { ANOMALY_PORT, type AnomalyPort } from "@contexts/anomaly/application/anomaly.port";
import {
  SCORER_PORT,
  type ScorerPort,
} from "@contexts/scoring/application/scorer.port";
import { LISTS_PORT, type ListsPort } from "@contexts/lists/application/lists.port";
import type { Policy } from "../domain/policy";
import { resolveVerdict } from "../domain/policy";
import type { Decision, Verdict } from "../domain/verdict";
import { VERDICT_REACHED, toVerdictReachedPayload } from "../domain/events";
import type { DecidePort } from "./decide.port";
import {
  POLICY_REPOSITORY_PORT,
  type PolicyRepositoryPort,
} from "./policy-repository.port";
import { VERDICT_LOG_PORT, type VerdictLogPort } from "./verdict-log.port";
import { REPLAY_LOG_PORT, type ReplayLogPort, type ReplaySample } from "./replay-log.port";
import { ACTIVITY_LOG_PORT, type ActivityEntry, type ActivityLogPort } from "./activity-log.port";
import { IDEMPOTENCY_STORE, type IdempotencyStore } from "./idempotency.port";
import { OUTBOX_PORT, type OutboxPort } from "./outbox.port";
import { sanitizeRequest } from "../domain/sanitize";

type Reason = { tag: string; points: number };
type Outcome = { decision: Decision; reviewQueue?: string; replay?: ReplaySample };

/**
 * The orchestrator — it owns only the wiring of the request path: no rules math,
 * no scoring, no storage of its own. Computation (evaluate) and the commit are
 * separated so a decision is written exactly once, and a failure in either yields a
 * clean outcome rather than a partial one.
 */
@Injectable()
export class DecideService implements DecidePort {
  constructor(
    @Inject(FEATURE_STORE_PORT) private readonly features: FeatureStorePort,
    @Inject(GRAPH_PORT) private readonly graph: GraphPort,
    @Inject(ANOMALY_PORT) private readonly anomaly: AnomalyPort,
    @Inject(RULES_ENGINE_PORT) private readonly rules: RulesEnginePort,
    @Inject(SCORER_PORT) private readonly scorer: ScorerPort,
    @Inject(LISTS_PORT) private readonly lists: ListsPort,
    @Inject(POLICY_REPOSITORY_PORT) private readonly policies: PolicyRepositoryPort,
    @Inject(VERDICT_LOG_PORT) private readonly log: VerdictLogPort,
    @Inject(REPLAY_LOG_PORT) private readonly replay: ReplayLogPort,
    @Inject(ACTIVITY_LOG_PORT) private readonly activity: ActivityLogPort,
    @Inject(IDEMPOTENCY_STORE) private readonly idempotency: IdempotencyStore,
    @Inject(OUTBOX_PORT) private readonly outbox: OutboxPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(STORE) private readonly store: Store,
    @Inject(ALERT_SETTINGS) private readonly alerts: AlertSettings,
  ) {}

  async decide(
    event: RiskEvent,
    correlationId: string,
    idempotencyKey?: string,
  ): Promise<Result<Decision>> {
    const started = Date.now();
    const key = idempotencyKey ?? event.id;
    const existing = await this.idempotency.get(key);
    if (existing) {
      decisionsTotal.inc({ verdict: existing.verdict, cached: "true" });
      return ok(existing);
    }

    const policy = await this.policies.loadFor(event.type);
    const outcome = await this.evaluate(event, policy);
    const decision = await this.commit(outcome, event, correlationId, key);
    decisionDuration.observe(Date.now() - started);
    // `decision` is the winner's — on a concurrent duplicate, commit returns the already-committed one.
    decisionsTotal.inc({ verdict: decision.verdict, cached: decision === outcome.decision ? "false" : "true" });
    return ok(decision);
  }

  /** O(1) read of a committed decision by idempotency key — used to poll an async submission's result. */
  lookup(idempotencyKey: string): Promise<Decision | undefined> {
    return this.idempotency.get(idempotencyKey);
  }

  private async evaluate(event: RiskEvent, policy: Policy): Promise<Outcome> {
    try {
      const list = await this.lists.check(event);
      if (list.decision === "deny") {
        return { decision: this.build(event, policy, "deny", [{ tag: "list.block", points: 0 }], -1) };
      }
      if (list.decision === "allow") {
        return { decision: this.build(event, policy, "allow", [{ tag: "list.allow", points: 0 }], -1) };
      }

      const base = await this.features.snapshot(event);
      const snapshot = {
        ...base,
        graph: await this.graph.featuresFor(event),
        anomaly: await this.anomaly.featuresFor(event),
      };
      const hits = await this.rules.evaluate(event, snapshot);
      const score = await this.scorer.score(hits, snapshot);
      const band = resolveVerdict(policy, score);

      let verdict: Verdict = band.verdict;
      const reasons: Reason[] = [...score.contributions];
      let reviewQueue = band.reviewQueue;

      if (list.decision === "watch" && (verdict === "allow" || verdict === "challenge")) {
        verdict = "review";
        reasons.push({ tag: "list.watch", points: 0 });
        reviewQueue = reviewQueue ?? "risk-ops";
      }

      await this.features.record(event);
      await this.graph.observe(event);
      await this.anomaly.observe(event);
      const decision = this.build(event, policy, verdict, reasons, score.value);
      const replay: ReplaySample = {
        eventId: event.id,
        eventType: event.type,
        event,
        features: snapshot,
        verdict: decision.verdict,
        score: decision.score,
        decidedAt: decision.decidedAt,
      };
      return { decision, reviewQueue, replay };
    } catch (cause) {
      // Fail on purpose to the policy's declared outcome — never a partial decision.
      const verdict: Verdict = policy.onError === "fail_open" ? "allow" : "deny";
      degradedTotal.inc({ verdict, onError: policy.onError });
      logEvent("error", "engine.degraded", {
        eventType: event.type,
        onError: policy.onError,
        verdict,
        cause: causeMessage(cause),
      });
      return { decision: this.build(event, policy, verdict, [{ tag: "engine.degraded", points: 0 }], -1) };
    }
  }

  /**
   * The durable commit for one decision. The idempotency claim, verdict log, activity entry, replay
   * sample and the outbox event(s) are written in a single transaction — either all land or none do.
   * The idempotency key is claimed with an atomic insert-if-absent: if another request already
   * committed this key (a concurrent duplicate), we write nothing and return that decision, so a
   * duplicate can never produce two verdicts or two outbox events, and a crash after commit is
   * covered because the idempotency record committed atomically with the verdict.
   */
  private async commit(outcome: Outcome, event: RiskEvent, correlationId: string, key: string): Promise<Decision> {
    const entry = this.activityEntry(outcome.decision, event);
    const outboxEvent = this.event(
      VERDICT_REACHED,
      correlationId,
      toVerdictReachedPayload(outcome.decision, event.type, outcome.reviewQueue),
    );
    const anomalyEvent = await this.anomalyAlertFor(outcome, event, correlationId);
    let committed = false;
    const decision = await this.store.transaction(async (tx) => {
      const prior = await this.idempotency.claim(tx, key, outcome.decision);
      if (prior) return prior; // a concurrent/earlier request won this key — write nothing else
      await this.log.append(outcome.decision, tx);
      await this.activity.append(entry, tx);
      if (outcome.replay) await this.replay.record(outcome.replay, tx);
      await this.outbox.enqueue(outboxEvent, tx);
      if (anomalyEvent) await this.outbox.enqueue(anomalyEvent, tx);
      committed = true;
      return outcome.decision;
    });
    // Nudge the relay only when we actually enqueued (non-blocking, off the request path).
    if (committed) this.outbox.flush();
    return decision;
  }

  /** Pair the (masked) request with its verdict for the API interaction log. */
  private activityEntry(decision: Decision, event: RiskEvent): ActivityEntry {
    return {
      id: decision.id,
      eventId: decision.eventId,
      eventType: event.type,
      request: sanitizeRequest(event),
      verdict: decision.verdict,
      score: decision.score,
      reasons: decision.reasons,
      policyId: decision.policyId,
      policyVersion: decision.policyVersion,
      decidedAt: decision.decidedAt,
    };
  }

  /**
   * An anomaly alert event when this decision's amount z-score crosses the configured threshold —
   * only when rules ran (so we have a snapshot). Enqueued in the same commit; nothing consumes it
   * unless an alert channel subscribes, so it's cheap when no one's listening.
   */
  private async anomalyAlertFor(
    outcome: Outcome,
    event: RiskEvent,
    correlationId: string,
  ): Promise<DomainEvent<AnomalyAlertPayload> | undefined> {
    const z = outcome.replay?.features.anomaly?.amountZScore;
    if (typeof z !== "number") return undefined;
    if (z < (await this.alerts.anomalyThreshold())) return undefined;
    return this.event<AnomalyAlertPayload>(ALERT_ANOMALY, correlationId, {
      userId: event.subject.userId,
      eventId: event.id,
      eventType: event.type,
      amountZScore: z,
      amount: event.money?.amount,
      currency: event.money?.currency,
      verdict: outcome.decision.verdict,
    });
  }

  private build(
    event: RiskEvent,
    policy: Policy,
    verdict: Verdict,
    reasons: Reason[],
    score: number,
  ): Decision {
    return {
      id: this.ids.next("vd") as VerdictId,
      eventId: event.id,
      verdict,
      score,
      reasons,
      policyId: policy.id,
      policyVersion: policy.version,
      decidedAt: this.clock.isoNow(),
    };
  }

  private event<T>(name: string, correlationId: string, payload: T): DomainEvent<T> {
    return {
      name,
      id: this.ids.next("evt"),
      occurredAt: this.clock.isoNow(),
      correlationId,
      payload,
    };
  }
}
