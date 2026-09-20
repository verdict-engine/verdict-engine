import {
  BadRequestException,
  Body,
  Controller,
  Headers,
  HttpCode,
  Inject,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { ApiBody, ApiHeader, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ApiKeyGuard } from "@shared/adapters/api-key.guard";
import { RateLimitGuard } from "@shared/adapters/rate-limit.guard";
import { RateLimit } from "@shared/adapters/rate-limit.decorator";
import { RequireApiScope } from "@shared/adapters/api-key-scope.decorator";
import { DecisionDto, DecisionEventDto } from "../../../../docs/api-dto";
import { ID_GENERATOR, type IdGenerator } from "@shared/ports/id-generator.port";
import { INGEST_PORT, type IngestPort } from "@contexts/ingest/application/ingest.port";
import { DECIDE_PORT, type DecidePort } from "../../application/decide.port";
import type { Decision } from "../../domain/verdict";

/**
 * Thin HTTP adapter — no business logic, so swapping HTTP for gRPC/a queue touches only adapters.
 *
 * POST /v1/decisions
 * Headers: `Idempotency-Key` (optional), `X-Correlation-Id` (optional).
 */
@ApiTags("Decisions")
@ApiSecurity("apikey")
@Controller("v1/decisions")
@UseGuards(ApiKeyGuard, RateLimitGuard)
export class DecisionController {
  constructor(
    @Inject(DECIDE_PORT) private readonly decide: DecidePort,
    @Inject(INGEST_PORT) private readonly ingest: IngestPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {}

  @Post()
  @HttpCode(200)
  @ApiOperation({
    summary: "Score an event and return a verdict",
    description:
      "The core endpoint. Submit a risk event (transaction, login, order) and receive an allow/challenge/review/deny verdict with a score and the reasons behind it. Authenticate with a service API key in the `X-API-Key` header.",
  })
  @RequireApiScope("decisions")
  @ApiBody({ type: DecisionEventDto })
  @ApiHeader({ name: "Idempotency-Key", required: false, description: "Replays return the original verdict instead of re-scoring." })
  @ApiHeader({ name: "X-Correlation-Id", required: false, description: "Echoed through logs and the stored verdict for tracing. Generated if omitted." })
  @ApiOkResponse({ type: DecisionDto, description: "The verdict. Returned with HTTP 200 even for a deny." })
  @RateLimit({ name: "decisions", by: "apikey" })
  async create(
    @Body() body: unknown,
    @Headers("idempotency-key") idempotencyKey?: string,
    @Headers("x-correlation-id") correlationId?: string,
  ): Promise<Decision> {
    const normalized = this.ingest.normalize(body);
    if (!normalized.ok) {
      // Fail closed to the client — a shaped error, never internals.
      throw new BadRequestException({
        error: true,
        code: normalized.error.code,
        message: normalized.error.message,
      });
    }

    const result = await this.decide.decide(
      normalized.value,
      correlationId ?? this.ids.next("cor"),
      idempotencyKey,
    );
    if (!result.ok) {
      throw new ServiceUnavailableException({
        error: true,
        code: result.error.code,
        message: "decision temporarily unavailable",
      });
    }
    return result.value;
  }
}
