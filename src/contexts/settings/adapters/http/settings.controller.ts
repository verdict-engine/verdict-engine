import { BadRequestException, Body, Controller, Get, Inject, Put, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminGuard } from "@shared/adapters/admin.guard";
import {
  RATE_LIMIT_SETTINGS,
  RateLimitConfigError,
  type RateLimitSettings,
  type RateLimitSnapshot,
} from "@shared/adapters/rate-limit-settings";
import {
  ALERT_SETTINGS,
  AlertConfigError,
  type AlertSettings,
  type AlertSnapshot,
} from "@shared/adapters/alert-settings";
import {
  SHADOW_SETTINGS,
  ShadowConfigError,
  type ShadowSettings,
  type ShadowSnapshot,
} from "@shared/adapters/shadow-settings";
import { AlertConfigDto, RateLimitConfigDto, ShadowConfigDto } from "../../../../docs/api-dto";

interface RateLimitPatch {
  decisionsPerMin?: number | null;
  loginPerMin?: number | null;
}

interface AlertPatch {
  anomalyZScore?: number | null;
}

interface ShadowPatch {
  forceShadow?: boolean | null;
}

@ApiTags("Settings")
@ApiBearerAuth("bearer")
@Controller("v1/config")
@UseGuards(AdminGuard)
export class SettingsController {
  constructor(
    @Inject(RATE_LIMIT_SETTINGS) private readonly rateLimits: RateLimitSettings,
    @Inject(ALERT_SETTINGS) private readonly alerts: AlertSettings,
    @Inject(SHADOW_SETTINGS) private readonly shadow: ShadowSettings,
  ) {}

  @Get("rate-limits")
  @ApiOperation({
    summary: "Get rate-limit settings",
    description: "Admin only. The effective per-minute budgets and whether each is a dashboard override or the env default.",
  })
  rateLimits_get(): Promise<RateLimitSnapshot> {
    return this.rateLimits.snapshot();
  }

  @Put("rate-limits")
  @ApiOperation({
    summary: "Update rate-limit settings",
    description: "Admin only. Override the per-minute budgets at runtime (no redeploy). Send a field as null to revert it to the env default. Changes apply within ~10s across replicas.",
  })
  @ApiBody({ type: RateLimitConfigDto })
  async rateLimits_put(@Body() body: RateLimitPatch): Promise<RateLimitSnapshot> {
    try {
      return await this.rateLimits.update({ decisionsPerMin: body.decisionsPerMin, loginPerMin: body.loginPerMin });
    } catch (e) {
      if (e instanceof RateLimitConfigError) throw new BadRequestException({ error: true, message: e.message });
      throw e;
    }
  }

  @Get("alerts")
  @ApiOperation({
    summary: "Get alert settings",
    description: "Admin only. The anomaly z-score threshold at or above which a decision emits alert.anomaly.v1.",
  })
  alerts_get(): Promise<AlertSnapshot> {
    return this.alerts.snapshot();
  }

  @Put("alerts")
  @ApiOperation({
    summary: "Update alert settings",
    description: "Admin only. Set the anomaly z-score threshold (send null to revert to the default of 3). Applies within ~10s.",
  })
  @ApiBody({ type: AlertConfigDto })
  async alerts_put(@Body() body: AlertPatch): Promise<AlertSnapshot> {
    try {
      return await this.alerts.update({ anomalyZScore: body.anomalyZScore });
    } catch (e) {
      if (e instanceof AlertConfigError) throw new BadRequestException({ error: true, message: e.message });
      throw e;
    }
  }

  @Get("shadow")
  @ApiOperation({
    summary: "Get the force-shadow setting",
    description: "Admin only. Whether every decision is currently forced into shadow mode (non-enforcing) deployment-wide, regardless of the per-request X-Verdict-Mode header.",
  })
  shadow_get(): Promise<ShadowSnapshot> {
    return this.shadow.snapshot();
  }

  @Put("shadow")
  @ApiOperation({
    summary: "Update the force-shadow setting",
    description: "Admin only. Turn deployment-wide force-shadow on or off — when on, every decision runs non-enforcing (logged for comparison, no fan-out, no case). Send null to revert to the default (off). Applies within ~10s.",
  })
  @ApiBody({ type: ShadowConfigDto })
  async shadow_put(@Body() body: ShadowPatch): Promise<ShadowSnapshot> {
    try {
      return await this.shadow.update({ forceShadow: body.forceShadow });
    } catch (e) {
      if (e instanceof ShadowConfigError) throw new BadRequestException({ error: true, message: e.message });
      throw e;
    }
  }
}
