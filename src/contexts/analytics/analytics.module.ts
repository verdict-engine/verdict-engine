import { Module } from "@nestjs/common";
import { ANALYTICS_PORT } from "./application/analytics.port";
import { AnalyticsService } from "./application/analytics.service";
import { AnalyticsController } from "./adapters/http/analytics.controller";

@Module({
  controllers: [AnalyticsController],
  providers: [
    AnalyticsService,
    { provide: ANALYTICS_PORT, useExisting: AnalyticsService },
  ],
})
export class AnalyticsModule {}
