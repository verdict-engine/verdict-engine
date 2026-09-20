import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "@shared/adapters/auth.guard";
import { ANALYTICS_PORT, type AnalyticsPort, type AnalyticsView } from "../../application/analytics.port";

@ApiTags("Analytics")
@ApiBearerAuth("bearer")
@Controller("v1/analytics")
@UseGuards(AuthGuard)
export class AnalyticsController {
  constructor(@Inject(ANALYTICS_PORT) private readonly analytics: AnalyticsPort) {}

  @Get("summary")
  @ApiOperation({ summary: "Decision analytics summary", description: "Aggregate verdict mix, volumes, and feedback metrics powering the dashboard." })
  summary(): Promise<AnalyticsView> {
    return this.analytics.summary();
  }
}
