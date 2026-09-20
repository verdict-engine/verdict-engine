import { Module } from "@nestjs/common";
import { RulesEnginePort, RULES_ENGINE_PORT } from "./application/rules-engine.port";
import { RulesEngineService } from "./application/rules-engine.service";
import { RULESET_REPOSITORY_PORT } from "./application/ruleset-repository.port";
import { RULESET_ADMIN_PORT } from "./application/ruleset-admin.port";
import { StoreRulesetRepository } from "./adapters/store/store-ruleset.repository";
import { RulesController } from "./adapters/http/rules.controller";

/**
 * Rules context. Exports only RULES_ENGINE_PORT — the Decision orchestrator injects the
 * interface, never the class. One versioned repository backs both the read and admin sides
 * (via useExisting), so an edit through the admin API is visible to the next decision.
 */
@Module({
  controllers: [RulesController],
  providers: [
    { provide: RULES_ENGINE_PORT, useClass: RulesEngineService },
    StoreRulesetRepository,
    { provide: RULESET_REPOSITORY_PORT, useExisting: StoreRulesetRepository },
    { provide: RULESET_ADMIN_PORT, useExisting: StoreRulesetRepository },
  ],
  exports: [RULES_ENGINE_PORT],
})
export class RulesModule {}

export type { RulesEnginePort };
export { RULES_ENGINE_PORT, RULESET_REPOSITORY_PORT };
