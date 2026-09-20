import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { AdminGuard } from "@shared/adapters/admin.guard";
import type { Principal } from "@shared/ports/token-verifier.port";
import { RegisterWebhookDto } from "../../../../docs/api-dto";
import {
  WEBHOOKS_PORT,
  WEBHOOK_QUEUE_PORT,
  type RegisteredWebhook,
  type WebhookQueuePort,
  type WebhooksPort,
} from "../../application/webhooks.port";
import { WebhookError } from "../../application/webhooks.service";
import type { WebhookDeliveryView } from "../../application/webhook-delivery.model";
import { WEBHOOK_EVENTS, type WebhookView } from "../../domain/webhook";

interface AdminRequest {
  principal?: Principal;
}

interface RegisterBody {
  url?: string;
  events?: string[];
}

@ApiTags("Webhooks")
@ApiBearerAuth("bearer")
@Controller("v1/webhooks")
@UseGuards(AdminGuard)
export class WebhooksController {
  constructor(
    @Inject(WEBHOOKS_PORT) private readonly webhooks: WebhooksPort,
    @Inject(WEBHOOK_QUEUE_PORT) private readonly queue: WebhookQueuePort,
  ) {}

  @Get()
  @ApiOperation({ summary: "List webhooks", description: "Admin only. Registered endpoints plus the set of event types you can subscribe to." })
  async list(): Promise<{ events: readonly string[]; endpoints: WebhookView[] }> {
    return { events: WEBHOOK_EVENTS, endpoints: await this.webhooks.list() };
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: "Register a webhook",
    description: "Admin only. Deliveries are POSTed with an HMAC `X-Verdict-Signature` header and retried in the background. Returns the signing secret once.",
  })
  @ApiBody({ type: RegisterWebhookDto })
  async register(@Body() body: RegisterBody, @Req() req: AdminRequest): Promise<RegisteredWebhook> {
    if (!body?.url) throw new BadRequestException({ error: true, message: "url is required" });
    try {
      return await this.webhooks.register({
        url: body.url,
        events: body.events ?? [],
        createdBy: req.principal?.email ?? "admin",
      });
    } catch (e) {
      if (e instanceof WebhookError) throw new BadRequestException({ error: true, message: e.message });
      throw e;
    }
  }

  @Post(":id/revoke")
  @HttpCode(200)
  @ApiOperation({ summary: "Revoke a webhook", description: "Admin only. Stops further deliveries to the endpoint." })
  @ApiParam({ name: "id" })
  async revoke(@Param("id") id: string): Promise<{ ok: true }> {
    await this.webhooks.revoke(id);
    return { ok: true };
  }

  @Get("deliveries")
  @ApiOperation({
    summary: "Delivery log",
    description: "Admin only. Pending deliveries (awaiting retry) and dead-lettered ones (exhausted their attempts).",
  })
  deliveries(): Promise<{ pending: WebhookDeliveryView[]; dead: WebhookDeliveryView[] }> {
    return this.queue.listDeliveries();
  }

  @Post("deliveries/redrive")
  @HttpCode(200)
  @ApiOperation({
    summary: "Re-drive dead-lettered deliveries",
    description: "Admin only. Moves every dead-lettered delivery back to pending for another attempt.",
  })
  async redrive(): Promise<{ requeued: number }> {
    return { requeued: await this.queue.redrive() };
  }
}
