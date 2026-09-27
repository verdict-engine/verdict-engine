import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  ServiceUnavailableException,
  UseGuards,
} from "@nestjs/common";
import { ApiBody, ApiHeader, ApiOkResponse, ApiOperation, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ApiKeyGuard } from "@shared/adapters/api-key.guard";
import { RateLimitGuard } from "@shared/adapters/rate-limit.guard";
import { RateLimit } from "@shared/adapters/rate-limit.decorator";
import { RequireApiScope } from "@shared/adapters/api-key-scope.decorator";
import { causeMessage, logEvent } from "@shared/observability/log";
import { BatchDecisionDto, DecisionDto, DecisionEventDto } from "../../../../docs/api-dto";
import { ID_GENERATOR, type IdGenerator } from "@shared/ports/id-generator.port";
import { INGEST_PORT, type IngestPort } from "@contexts/ingest/application/ingest.port";
import { DECIDE_PORT, type DecidePort } from "../../application/decide.port";
import type { Decision } from "../../domain/verdict";

const MAX_BATCH = 100;

/** One entry in a batch response: the verdict, or a shaped error for that event alone. */
type BatchItem = { ok: true; decision: Decision } | { ok: false; error: { code: string; message: string } };

/**
 * Thin HTTP adapter — no business logic, so swapping HTTP for gRPC/a queue touches only adapters.
 *
 * POST /v1/decisions            — score one event, return the verdict (sync)
 * POST /v1/decisions/batch      — score up to 100 events in one call
 * POST /v1/decisions/async      — accept an event (202), score it off the response, poll the result
 * GET  /v1/decisions/:id        — fetch a decision by event id (for an async submission)
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
      throw new BadRequestException({ error: true, code: normalized.error.code, message: normalized.error.message });
    }

    const result = await this.decide.decide(normalized.value, correlationId ?? this.ids.next("cor"), idempotencyKey);
    if (!result.ok) {
      throw new ServiceUnavailableException({ error: true, code: result.error.code, message: "decision temporarily unavailable" });
    }
    return result.value;
  }

  @Post("batch")
  @HttpCode(200)
  @ApiOperation({
    summary: "Score up to 100 events in one call",
    description:
      "Submit an array of events under `events`; each is scored independently and the response preserves order. A bad event fails only its own entry (ok:false), never the whole batch. Same idempotency semantics per event (keyed by its id).",
  })
  @RequireApiScope("decisions")
  @ApiBody({ type: BatchDecisionDto })
  @RateLimit({ name: "decisions", by: "apikey" })
  async createBatch(@Body() body: { events?: unknown[] }, @Headers("x-correlation-id") correlationId?: string): Promise<{ results: BatchItem[] }> {
    const events = body?.events;
    if (!Array.isArray(events)) throw new BadRequestException({ error: true, code: "INVALID_BATCH", message: "body.events must be an array" });
    if (events.length === 0 || events.length > MAX_BATCH) {
      throw new BadRequestException({ error: true, code: "INVALID_BATCH", message: `events must contain between 1 and ${MAX_BATCH} items` });
    }
    const cor = correlationId ?? this.ids.next("cor");
    const results = await Promise.all(events.map((e) => this.decideOne(e, cor)));
    return { results };
  }

  @Post("async")
  @HttpCode(202)
  @ApiOperation({
    summary: "Accept an event and score it off the response path",
    description:
      "Returns 202 immediately with the event id; the verdict is computed in the background and written durably. Poll `GET /v1/decisions/{id}` for the result, or subscribe a webhook to `verdict.reached.v1`. Idempotency is keyed by the event id.",
  })
  @RequireApiScope("decisions")
  @ApiBody({ type: DecisionEventDto })
  async createAsync(@Body() body: unknown, @Headers("x-correlation-id") correlationId?: string): Promise<{ accepted: true; id: string; correlationId: string }> {
    const normalized = this.ingest.normalize(body);
    if (!normalized.ok) {
      throw new BadRequestException({ error: true, code: normalized.error.code, message: normalized.error.message });
    }
    const event = normalized.value;
    const cor = correlationId ?? this.ids.next("cor");
    // Fire-and-forget: the verdict lands in the durable log + idempotency store and fans out on the bus.
    void this.decide.decide(event, cor, event.id).then(
      (r) => {
        if (!r.ok) logEvent("error", "decision.async_failed", { eventId: event.id, code: r.error.code });
      },
      (cause) => logEvent("error", "decision.async_failed", { eventId: event.id, cause: causeMessage(cause) }),
    );
    return { accepted: true, id: event.id, correlationId: cor };
  }

  @Get(":id")
  @ApiOperation({
    summary: "Fetch a decision by event id",
    description: "Returns the verdict for an event id (e.g. one submitted via /async). 404 while it is still pending or if the id is unknown.",
  })
  @RequireApiScope("decisions")
  @ApiOkResponse({ type: DecisionDto })
  async byId(@Param("id") id: string): Promise<Decision> {
    const decision = await this.decide.lookup(id);
    if (!decision) throw new NotFoundException({ error: true, code: "NOT_FOUND", message: "no decision for that id yet" });
    return decision;
  }

  /** Normalize + decide one event into a batch entry, mapping failures to a per-item error. */
  private async decideOne(raw: unknown, correlationId: string): Promise<BatchItem> {
    const normalized = this.ingest.normalize(raw);
    if (!normalized.ok) return { ok: false, error: { code: normalized.error.code, message: normalized.error.message } };
    const result = await this.decide.decide(normalized.value, correlationId, normalized.value.id);
    if (!result.ok) return { ok: false, error: { code: result.error.code, message: "decision temporarily unavailable" } };
    return { ok: true, decision: result.value };
  }
}
