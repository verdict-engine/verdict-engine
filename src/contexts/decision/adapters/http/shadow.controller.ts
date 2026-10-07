import { Controller, Get, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "@shared/adapters/auth.guard";
import { ShadowReportDto } from "../../../../docs/api-dto";
import { ShadowReportService, type ShadowReport } from "../../application/shadow-report.service";

/** Operator-facing report comparing shadow-mode verdicts against confirmed fraud over a window. */
@ApiTags("Decisions")
@ApiBearerAuth("bearer")
@Controller("v1/shadow")
@UseGuards(AuthGuard)
export class ShadowController {
  constructor(private readonly shadow: ShadowReportService) {}

  @Get("report")
  @ApiOperation({
    summary: "Shadow-mode comparison report",
    description:
      "Summarizes decisions scored in shadow mode (X-Verdict-Mode: shadow) over the last `days`: what the policy would have blocked, and — as chargeback labels arrive — what share of confirmed fraud it would have caught vs missed. The report to compare Verdict against your current rules before switching.",
  })
  @ApiQuery({ name: "days", required: false, description: "Lookback window in days. Default 30." })
  @ApiQuery({ name: "limit", required: false, description: "Most-recent decisions to scan (1–100000). Default 10000." })
  @ApiOkResponse({ type: ShadowReportDto })
  report(@Query("days") days?: string, @Query("limit") limit?: string): Promise<ShadowReport> {
    const sinceDays = Math.min(Math.max(Number(days) || 30, 1), 3650);
    return this.shadow.report(sinceDays, Number(limit) || undefined);
  }
}
