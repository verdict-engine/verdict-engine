import { Module } from "@nestjs/common";
import { IngestModule } from "@contexts/ingest/ingest.module";
import { FeatureStoreModule } from "@contexts/feature-store/feature-store.module";
import { RulesModule } from "@contexts/rules/rules.module";
import { ScoringModule } from "@contexts/scoring/scoring.module";
import { ListsModule } from "@contexts/lists/lists.module";
import { GraphModule } from "@contexts/graph/graph.module";
import { AnomalyModule } from "@contexts/anomaly/anomaly.module";
import { FeedbackModule } from "@contexts/feedback/feedback.module";
import { DecisionController } from "./adapters/http/decision.controller";
import { ConfigController } from "./adapters/http/config.controller";
import { PrivacyController } from "./adapters/http/privacy.controller";
import { DECIDE_PORT } from "./application/decide.port";
import { DecideService } from "./application/decide.service";
import { BacktestService } from "./application/backtest.service";
import { ErasureService } from "./application/erasure.service";
import { POLICY_REPOSITORY_PORT } from "./application/policy-repository.port";
import { POLICY_ADMIN_PORT } from "./application/policy-admin.port";
import { VERDICT_LOG_PORT } from "./application/verdict-log.port";
import { REPLAY_LOG_PORT } from "./application/replay-log.port";
import { ACTIVITY_LOG_PORT } from "./application/activity-log.port";
import { IDEMPOTENCY_STORE } from "./application/idempotency.port";
import { OUTBOX_PORT } from "./application/outbox.port";
import { StorePolicyRepository } from "./adapters/store/store-policy.repository";
import { StoreVerdictLog } from "./adapters/store/store-verdict-log.adapter";
import { StoreReplayLog } from "./adapters/store/store-replay-log.adapter";
import { StoreActivityLog } from "./adapters/store/store-activity-log.adapter";
import { StoreIdempotency } from "./adapters/store/store-idempotency.adapter";
import { OutboxRelay } from "./application/outbox-relay.service";

/**
 * One instance of StorePolicyRepository backs both the read port and the admin port (via
 * useExisting), so a rollback through the admin side is visible to reads. It persists every version
 * to the STORE, so runtime policy changes survive a restart.
 */
@Module({
  imports: [IngestModule, FeatureStoreModule, RulesModule, ScoringModule, ListsModule, GraphModule, AnomalyModule, FeedbackModule],
  controllers: [DecisionController, ConfigController, PrivacyController],
  providers: [
    { provide: DECIDE_PORT, useClass: DecideService },
    BacktestService,
    ErasureService,
    StorePolicyRepository,
    { provide: POLICY_REPOSITORY_PORT, useExisting: StorePolicyRepository },
    { provide: POLICY_ADMIN_PORT, useExisting: StorePolicyRepository },
    { provide: VERDICT_LOG_PORT, useClass: StoreVerdictLog },
    { provide: REPLAY_LOG_PORT, useClass: StoreReplayLog },
    { provide: ACTIVITY_LOG_PORT, useClass: StoreActivityLog },
    { provide: IDEMPOTENCY_STORE, useClass: StoreIdempotency },
    { provide: OUTBOX_PORT, useClass: OutboxRelay },
  ],
  exports: [DECIDE_PORT, POLICY_ADMIN_PORT],
})
export class DecisionModule {}

export { DECIDE_PORT, POLICY_ADMIN_PORT, POLICY_REPOSITORY_PORT };
