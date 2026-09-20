import { Module } from "@nestjs/common";
import { SharedModule } from "@shared/shared.module";
import { AuthModule } from "@contexts/auth/auth.module";
import { ApiKeysModule } from "@contexts/apikeys/apikeys.module";
import { IngestModule } from "@contexts/ingest/ingest.module";
import { FeatureStoreModule } from "@contexts/feature-store/feature-store.module";
import { RulesModule } from "@contexts/rules/rules.module";
import { ScoringModule } from "@contexts/scoring/scoring.module";
import { ListsModule } from "@contexts/lists/lists.module";
import { GraphModule } from "@contexts/graph/graph.module";
import { AnomalyModule } from "@contexts/anomaly/anomaly.module";
import { DecisionModule } from "@contexts/decision/decision.module";
import { CasesModule } from "@contexts/cases/cases.module";
import { FeedbackModule } from "@contexts/feedback/feedback.module";
import { AnalyticsModule } from "@contexts/analytics/analytics.module";
import { WebhooksModule } from "@contexts/webhooks/webhooks.module";
import { NotificationsModule } from "@contexts/notifications/notifications.module";
import { SettingsModule } from "@contexts/settings/settings.module";
import { RetentionModule } from "@contexts/retention/retention.module";
import { AuditModule } from "@contexts/audit/audit.module";
import { HealthController } from "./health.controller";
import { MetricsController } from "./metrics.controller";

/**
 * The composition root and seam map: to extract a context into its own service, remove
 * its module here, stand it up behind the same ports, and rebind the EventBus to a broker.
 */
@Module({
  imports: [
    SharedModule,
    AuthModule,
    ApiKeysModule,
    IngestModule,
    FeatureStoreModule,
    RulesModule,
    ScoringModule,
    ListsModule,
    GraphModule,
    AnomalyModule,
    DecisionModule,
    CasesModule,
    FeedbackModule,
    AnalyticsModule,
    WebhooksModule,
    NotificationsModule,
    SettingsModule,
    RetentionModule,
    AuditModule,
  ],
  controllers: [HealthController, MetricsController],
})
export class AppModule {}
