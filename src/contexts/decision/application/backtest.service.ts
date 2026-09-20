import { Inject, Injectable } from "@nestjs/common";
import {
  RULES_ENGINE_PORT,
  type RulesEnginePort,
} from "@contexts/rules/application/rules-engine.port";
import type { Rule } from "@contexts/rules/application/ruleset.contracts";
import { FEEDBACK_PORT, type FeedbackPort } from "@contexts/feedback/application/feedback.port";
import type { RiskScore } from "@contexts/scoring/application/scorer.port";
import {
  computeBacktest,
  weightedScore,
  type BacktestResult,
  type BacktestRow,
  type Label,
} from "../domain/backtest";
import { resolveVerdict, validatePolicy, type Band, type Policy } from "../domain/policy";
import { POLICY_REPOSITORY_PORT, type PolicyRepositoryPort } from "./policy-repository.port";
import { REPLAY_LOG_PORT, type ReplayLogPort } from "./replay-log.port";

const SAMPLE_LIMIT = 5000;
const EPOCH = "1970-01-01T00:00:00.000Z";

export interface BacktestInput {
  eventType: string;
  rules?: Rule[];
  policy?: { bands: Band[]; onError?: "fail_open" | "fail_closed" };
}

export interface BacktestReport extends BacktestResult {
  eventType: string;
  sampleSize: number;
  changed: { rules: boolean; policy: boolean };
}

/**
 * Replays a candidate rule and/or policy change over the stored (event, features) history
 * and scores it against the labels we have. A policy-only change reuses each decision's
 * recorded score; a rule change re-evaluates the candidate ruleset. Read-only — it never
 * writes a verdict, records a label, or touches the request path.
 */
@Injectable()
export class BacktestService {
  constructor(
    @Inject(RULES_ENGINE_PORT) private readonly rules: RulesEnginePort,
    @Inject(REPLAY_LOG_PORT) private readonly replay: ReplayLogPort,
    @Inject(FEEDBACK_PORT) private readonly feedback: FeedbackPort,
    @Inject(POLICY_REPOSITORY_PORT) private readonly policies: PolicyRepositoryPort,
  ) {}

  async run(input: BacktestInput): Promise<BacktestReport> {
    const samples = await this.replay.samplesFor(input.eventType, SAMPLE_LIMIT);
    const labelBy = await this.labelIndex();
    const policy = await this.candidatePolicy(input);

    const rows: BacktestRow[] = [];
    for (const s of samples) {
      const label = labelBy.get(s.eventId);
      if (!label) continue;
      const score = input.rules ? weightedScore(this.rules.evaluateRuleset(input.rules, s.event, s.features)) : s.score;
      rows.push({ candidate: resolveVerdict(policy, riskScore(score)).verdict, actual: s.verdict, label });
    }

    return {
      eventType: input.eventType,
      sampleSize: samples.length,
      changed: { rules: Boolean(input.rules), policy: Boolean(input.policy) },
      ...computeBacktest(rows),
    };
  }

  private async candidatePolicy(input: BacktestInput): Promise<Policy> {
    const base = await this.policies.loadFor(input.eventType);
    if (!input.policy) return base;
    const candidate: Policy = {
      id: base.id,
      version: "candidate",
      bands: input.policy.bands,
      onError: input.policy.onError ?? base.onError,
    };
    const error = validatePolicy(candidate);
    if (error) throw new BacktestError(error);
    return candidate;
  }

  private async labelIndex(): Promise<Map<string, Label>> {
    const labels = await this.feedback.since(EPOCH);
    const byEvent = new Map<string, Label>();
    for (const l of labels) {
      // Fraud is the stronger ground truth — a chargeback outweighs a legit resolution.
      if (l.outcome === "fraud" || !byEvent.has(l.eventId)) byEvent.set(l.eventId, l.outcome);
    }
    return byEvent;
  }
}

export class BacktestError extends Error {}

function riskScore(value: number): RiskScore {
  return { value, contributions: [], model: "backtest" };
}
