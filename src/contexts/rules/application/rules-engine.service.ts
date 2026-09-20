import { Inject, Injectable } from "@nestjs/common";
import type { FeatureSnapshot } from "@contexts/feature-store/application/feature-store.port";
import type { RiskEvent } from "@contexts/ingest/application/ingest.port";
import { evaluateRules } from "../domain/evaluate";
import type { Rule, RuleHit } from "../domain/rule";
import type { RulesEnginePort } from "./rules-engine.port";
import {
  RULESET_REPOSITORY_PORT,
  type RulesetRepositoryPort,
} from "./ruleset-repository.port";

@Injectable()
export class RulesEngineService implements RulesEnginePort {
  constructor(
    @Inject(RULESET_REPOSITORY_PORT)
    private readonly rulesets: RulesetRepositoryPort,
  ) {}

  async evaluate(event: RiskEvent, features: FeatureSnapshot): Promise<RuleHit[]> {
    const { rules } = await this.rulesets.load(event.type);
    return evaluateRules(rules, event, features);
  }

  evaluateRuleset(rules: readonly Rule[], event: RiskEvent, features: FeatureSnapshot): RuleHit[] {
    return evaluateRules(rules, event, features);
  }
}
