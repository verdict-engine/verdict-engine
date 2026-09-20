import {
  BadRequestException,
  Controller,
  ConflictException,
  Get,
  Inject,
  NotFoundException,
  Param,
  Post,
  Body,
  Query,
  Req,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiQuery, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "@shared/adapters/auth.guard";
import { DomainError } from "@shared/domain/result";
import type { Principal } from "@shared/ports/token-verifier.port";
import type { CaseId } from "@shared/domain/ids";
import { ResolveCaseDto } from "../../../../docs/api-dto";
import {
  CASES_PORT,
  type CasesPort,
  type FraudCase,
  type ResolutionOutcome,
} from "../../application/cases.port";

const OUTCOMES: ReadonlySet<string> = new Set<ResolutionOutcome>(["fraud", "legit", "inconclusive"]);

interface AuthedRequest {
  principal?: Principal;
}

@ApiTags("Cases")
@ApiBearerAuth("bearer")
@Controller("v1/cases")
@UseGuards(AuthGuard)
export class CasesController {
  constructor(@Inject(CASES_PORT) private readonly cases: CasesPort) {}

  @Get()
  @ApiOperation({ summary: "List the review queue", description: "Cases the engine sent to review. Any operator." })
  @ApiQuery({ name: "queue", required: false, description: "Queue name. Defaults to `risk-ops`." })
  list(@Query("queue") queue?: string): Promise<FraudCase[]> {
    return this.cases.listQueue(queue ?? "risk-ops");
  }

  @Get(":id")
  @ApiOperation({ summary: "Get one case" })
  @ApiParam({ name: "id", description: "Case id (the verdict id of the reviewed event)." })
  async getOne(@Param("id") id: string): Promise<FraudCase> {
    const found = await this.cases.get(id as CaseId);
    if (!found) throw new NotFoundException({ error: true, code: "CASE_NOT_FOUND" });
    return found;
  }

  @Post(":id/assign")
  @ApiOperation({ summary: "Assign a case to yourself", description: "Assigns the case to the calling operator." })
  @ApiParam({ name: "id" })
  assign(@Param("id") id: string, @Req() req: AuthedRequest): Promise<FraudCase> {
    return this.run(() => this.cases.assign(id as CaseId, analyst(req)));
  }

  @Post(":id/resolve")
  @ApiOperation({ summary: "Resolve a case", description: "Closes the case with an outcome, which feeds the feedback loop and adaptive model." })
  @ApiParam({ name: "id" })
  @ApiBody({ type: ResolveCaseDto })
  resolve(
    @Param("id") id: string,
    @Body() body: { outcome?: string; note?: string },
    @Req() req: AuthedRequest,
  ): Promise<FraudCase> {
    if (!body.outcome || !OUTCOMES.has(body.outcome)) {
      throw new BadRequestException({ error: true, message: "outcome must be fraud | legit | inconclusive" });
    }
    return this.run(() =>
      this.cases.resolve(id as CaseId, {
        outcome: body.outcome as ResolutionOutcome,
        analyst: analyst(req),
        note: body.note,
      }),
    );
  }

  private async run(op: () => Promise<FraudCase>): Promise<FraudCase> {
    try {
      return await op();
    } catch (e) {
      if (e instanceof DomainError && e.code === "CASE_NOT_FOUND") {
        throw new NotFoundException({ error: true, code: e.code });
      }
      if (e instanceof DomainError && e.code === "CASE_RESOLVED") {
        throw new ConflictException({ error: true, code: e.code, message: e.message });
      }
      throw e;
    }
  }
}

function analyst(req: AuthedRequest): string {
  if (!req.principal) throw new UnauthorizedException({ error: true, code: "UNAUTHENTICATED" });
  return req.principal.email;
}
