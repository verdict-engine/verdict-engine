import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "@shared/adapters/auth.guard";
import { AdminGuard } from "@shared/adapters/admin.guard";
import { DomainError } from "@shared/domain/result";
import { RollbackDto, RulesetDto } from "../../../../docs/api-dto";
import { ruleToDsl } from "../../domain/describe";
import { validateRuleset } from "../../domain/validate-ruleset";
import type { Condition, Rule } from "../../domain/rule";
import {
  RULESET_REPOSITORY_PORT,
  type Ruleset,
  type RulesetRepositoryPort,
} from "../../application/ruleset-repository.port";
import { RULESET_ADMIN_PORT, type RulesetAdminPort } from "../../application/ruleset-admin.port";

interface RuleView {
  id: string;
  tag: string;
  weight: number;
  condition: Condition;
  dsl: string;
}

@ApiTags("Rules")
@ApiBearerAuth("bearer")
@Controller("v1/rules")
@UseGuards(AuthGuard)
export class RulesController {
  constructor(
    @Inject(RULESET_REPOSITORY_PORT) private readonly rulesets: RulesetRepositoryPort,
    @Inject(RULESET_ADMIN_PORT) private readonly admin: RulesetAdminPort,
  ) {}

  @Get()
  @ApiOperation({ summary: "List rulesets", description: "The active ruleset per event type, each rule with its human-readable DSL." })
  async list(): Promise<Array<{ eventType: string; version: string; rules: RuleView[] }>> {
    const all = await this.rulesets.listAll();
    return all.map((r) => ({
      eventType: r.eventType,
      version: r.version,
      rules: r.rules.map(toView),
    }));
  }

  @Get(":eventType/history")
  @ApiOperation({ summary: "Ruleset version history", description: "All published versions for an event type, newest first." })
  @ApiParam({ name: "eventType", example: "payment.authorize" })
  history(@Param("eventType") eventType: string): Promise<string[]> {
    return this.admin.history(eventType);
  }

  @Post()
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Publish a ruleset", description: "Admin only. Publishes a new version of the ruleset for an event type. Rules are validated before publish." })
  @ApiBody({ type: RulesetDto })
  async publish(@Body() body: Ruleset): Promise<{ ok: true; version: string }> {
    if (!body?.eventType?.trim()) throw new BadRequestException({ error: true, message: "eventType is required" });
    if (!body?.version?.trim()) throw new BadRequestException({ error: true, message: "version is required" });
    const error = validateRuleset(body.rules ?? []);
    if (error) throw new BadRequestException({ error: true, message: error });
    await this.admin.publish({ eventType: body.eventType, version: body.version, rules: normalize(body.rules) });
    return { ok: true, version: body.version };
  }

  @Post(":eventType/rollback")
  @UseGuards(AdminGuard)
  @ApiOperation({ summary: "Roll back a ruleset", description: "Admin only. Re-activates a previously published version for an event type." })
  @ApiParam({ name: "eventType", example: "payment.authorize" })
  @ApiBody({ type: RollbackDto })
  async rollback(@Param("eventType") eventType: string, @Body("toVersion") toVersion?: string): Promise<{ ok: true }> {
    if (!toVersion) throw new BadRequestException({ error: true, message: "toVersion is required" });
    try {
      await this.admin.rollback(eventType, toVersion);
      return { ok: true };
    } catch (e) {
      if (e instanceof DomainError && e.code === "RULESET_VERSION_UNKNOWN") {
        throw new NotFoundException({ error: true, code: e.code, message: e.message });
      }
      throw e;
    }
  }
}

const toView = (rule: Rule): RuleView => ({
  id: rule.id,
  tag: rule.tag,
  weight: rule.weight,
  condition: rule.condition,
  dsl: ruleToDsl(rule),
});

/** A rule's `name` defaults to its id when the author didn't set one. */
const normalize = (rules: Rule[]): Rule[] => rules.map((r) => ({ ...r, name: r.name?.trim() || r.id }));
