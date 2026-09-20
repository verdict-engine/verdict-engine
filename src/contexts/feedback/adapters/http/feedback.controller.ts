import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  Inject,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiAcceptedResponse, ApiBody, ApiOperation, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { ApiKeyGuard } from "@shared/adapters/api-key.guard";
import { RequireApiScope } from "@shared/adapters/api-key-scope.decorator";
import { CLOCK, type Clock } from "@shared/ports/clock.port";
import { ChargebackDto } from "../../../../docs/api-dto";
import { FeedbackService } from "../../application/feedback.service";

/** Chargebacks arrive from the PSP as ground-truth fraud labels on a past event. */
@ApiTags("Feedback")
@ApiSecurity("apikey")
@Controller("v1/labels")
@UseGuards(ApiKeyGuard)
export class FeedbackController {
  constructor(
    private readonly feedback: FeedbackService,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  @Post("chargeback")
  @HttpCode(202)
  @RequireApiScope("labels")
  @ApiOperation({
    summary: "Report a chargeback (fraud label)",
    description:
      "Closes the feedback loop. Labels a past event as fraud and feeds the adaptive model and analytics. Authenticate with `X-API-Key`. Returns 202 — processing is asynchronous.",
  })
  @ApiBody({ type: ChargebackDto })
  @ApiAcceptedResponse({ description: "Accepted for processing.", schema: { example: { recorded: true } } })
  async chargeback(@Body("eventId") eventId?: string): Promise<{ recorded: true }> {
    if (!eventId) throw new BadRequestException({ error: true, message: "eventId is required" });
    await this.feedback.record({
      eventId,
      outcome: "fraud",
      source: "chargeback",
      at: this.clock.isoNow(),
    });
    return { recorded: true };
  }
}
