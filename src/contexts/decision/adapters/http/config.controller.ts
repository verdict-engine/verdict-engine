import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Query,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "@shared/adapters/auth.guard";
import { AdminGuard } from "@shared/adapters/admin.guard";
import { DomainError } from "@shared/domain/result";
import type { PolicyId } from "@shared/domain/ids";
import { ActivityEntryDto, BacktestDto, PolicyDto, RollbackDto, SimulateDto } from "../../../../docs/api-dto";
import { POLICY_ADMIN_PORT, type ActivePolicy, type PolicyAdminPort } from "../../application/policy-admin.port";
import { VERDICT_LOG_PORT, type VerdictLogPort } from "../../application/verdict-log.port";
import { ACTIVITY_LOG_PORT, type ActivityEntry, type ActivityLogPort } from "../../application/activity-log.port";
import {
  BacktestError,
  BacktestService,
  type BacktestInput,
  type BacktestReport,
} from "../../application/backtest.service";
import { resolveVerdict, validatePolicy, type Policy } from "../../domain/policy";
import type { Decision, Verdict } from "../../domain/verdict";

@ApiTags("Policies")
@ApiBearerAuth("bearer")
@Controller("v1")
@UseGuards(AuthGuard)
export class ConfigController {
  constructor(
    @Inject(POLICY_ADMIN_PORT) private readonly policies: PolicyAdminPort,
    @Inject(VERDICT_LOG_PORT) private readonly log: VerdictLogPort,
    @Inject(ACTIVITY_LOG_PORT) private readonly activity: ActivityLogPort,
    private readonly backtester: BacktestService,
  ) {}

  @Get("policies")
  @ApiOperation({ summary: "List active policies", description: "The currently active policy per policy id, with its bands." })
  listPolicies(): Promise<ActivePolicy[]> {
    return this.policies.listActive();
  }

  @Get("policies/:id/history")
  @ApiOperation({ summary: "Policy version history", description: "All published versions of a policy, newest first." })
  @ApiParam({ name: "id" })
  history(@Param("id") id: string): Promise<string[]> {
    return this.policies.history(id as PolicyId);
  }

  @Post("policies")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Publish a policy", description: "Admin only. Publishes a new version of a policy (score → verdict bands). Additive — old versions stay for rollback." })
  @ApiBody({ type: PolicyDto })
  async publish(@Body() body: Policy): Promise<{ ok: true; version: string }> {
    const error = validatePolicy(body);
    if (error) throw new BadRequestException({ error: true, message: error });
    await this.policies.publish(body);
    return { ok: true, version: body.version };
  }

  @Post("policies/:id/rollback")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Roll back a policy", description: "Admin only. Re-activates a previously published version." })
  @ApiParam({ name: "id" })
  @ApiBody({ type: RollbackDto })
  async rollback(@Param("id") id: string, @Body("toVersion") toVersion?: string): Promise<{ ok: true }> {
    if (!toVersion) throw new BadRequestException({ error: true, message: "toVersion is required" });
    try {
      await this.policies.rollback(id as PolicyId, toVersion);
      return { ok: true };
    } catch (e) {
      if (e instanceof DomainError && e.code === "POLICY_VERSION_UNKNOWN") {
        throw new NotFoundException({ error: true, code: e.code, message: e.message });
      }
      throw e;
    }
  }

  @Post("policies/:id/simulate")
  @ApiOperation({ summary: "Simulate a score", description: "Run a hypothetical score through a policy's bands to see which verdict it would produce." })
  @ApiParam({ name: "id" })
  @ApiBody({ type: SimulateDto })
  async simulate(
    @Param("id") id: string,
    @Body("score") score?: number,
  ): Promise<{ verdict: Verdict; reviewQueue?: string }> {
    if (typeof score !== "number" || score < 0 || score > 100) {
      throw new BadRequestException({ error: true, message: "score must be a number 0–100" });
    }
    const active = (await this.policies.listActive()).find((p) => p.policy.id === id);
    if (!active) throw new NotFoundException({ error: true, code: "POLICY_MISSING" });
    const band = resolveVerdict(active.policy, { value: score, contributions: [], model: "simulate" });
    return { verdict: band.verdict, reviewQueue: band.reviewQueue };
  }

  @Get("verdicts")
  @ApiTags("Decisions")
  @ApiOperation({ summary: "Recent verdicts", description: "The most recent decisions from the append-only verdict log." })
  @ApiQuery({ name: "limit", required: false, description: "1–100. Defaults to 25." })
  recentVerdicts(@Query("limit") limit?: string): Promise<Decision[]> {
    const n = Math.min(Math.max(Number(limit) || 25, 1), 100);
    return this.log.recent(n);
  }

  @Get("activity")
  @ApiTags("Activity")
  @ApiOperation({
    summary: "API interaction log",
    description:
      "The full request/response log for scored decisions, newest first — each entry pairs the request payload with the verdict it produced. Personal data (phone numbers, IPs) is masked; card data is BIN-only.",
  })
  @ApiQuery({ name: "limit", required: false, description: "1–200. Defaults to 100." })
  @ApiOkResponse({ type: [ActivityEntryDto] })
  recentActivity(@Query("limit") limit?: string): Promise<ActivityEntry[]> {
    const n = Math.min(Math.max(Number(limit) || 100, 1), 200);
    return this.activity.recent(n);
  }

  @Post("backtest")
  @HttpCode(200)
  @UseGuards(AdminGuard)
  @ApiOperation({
    summary: "Backtest rules/policy against history",
    description: "Admin only. Replays historical events of an event type through candidate rules and/or policy bands and reports how the verdict mix would change.",
  })
  @ApiBody({ type: BacktestDto })
  async backtest(@Body() body: BacktestInput): Promise<BacktestReport> {
    if (!body?.eventType) throw new BadRequestException({ error: true, message: "eventType is required" });
    try {
      return await this.backtester.run(body);
    } catch (e) {
      if (e instanceof BacktestError) throw new BadRequestException({ error: true, message: e.message });
      throw e;
    }
  }
}
