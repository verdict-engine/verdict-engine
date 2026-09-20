import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, Post, Req, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { AdminGuard } from "@shared/adapters/admin.guard";
import type { Principal } from "@shared/ports/token-verifier.port";
import { RegisterChannelDto } from "../../../../docs/api-dto";
import {
  NOTIFICATIONS_PORT,
  NOTIFICATION_QUEUE_PORT,
  type NotificationsPort,
  type NotificationQueuePort,
} from "../../application/notifications.port";
import type { NotificationDeliveryView } from "../../application/notification-delivery.model";
import { NotificationError } from "../../application/notifications.service";
import { NOTIFY_EVENTS, type ChannelView, type ChannelType, type NotifyEvent } from "../../domain/notification";

interface AdminRequest {
  principal?: Principal;
}

interface RegisterBody {
  type?: ChannelType;
  url?: string;
  target?: string;
  events?: NotifyEvent[];
  minVerdict?: string;
  throttlePerMin?: number;
}

@ApiTags("Notifications")
@ApiBearerAuth("bearer")
@Controller("v1/notifications")
@UseGuards(AdminGuard)
export class NotificationsController {
  constructor(
    @Inject(NOTIFICATIONS_PORT) private readonly notifications: NotificationsPort,
    @Inject(NOTIFICATION_QUEUE_PORT) private readonly queue: NotificationQueuePort,
  ) {}

  @Get()
  @ApiOperation({ summary: "List alert channels", description: "Admin only. Configured Slack/webhook channels (URLs masked) plus the events you can subscribe to." })
  async list(): Promise<{ events: readonly string[]; channels: ChannelView[] }> {
    return { events: NOTIFY_EVENTS, channels: await this.notifications.list() };
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: "Add an alert channel",
    description:
      "Admin only. Register a Slack incoming-webhook, a Telegram bot (url = https://api.telegram.org/bot<token>/sendMessage, target = chat id), or a generic HTTPS endpoint. For verdict.reached you can set a minimum severity (e.g. only `deny`).",
  })
  @ApiBody({ type: RegisterChannelDto })
  async register(@Body() body: RegisterBody, @Req() req: AdminRequest): Promise<ChannelView> {
    if (!body?.type || !body?.url) throw new BadRequestException({ error: true, message: "type and url are required" });
    try {
      return await this.notifications.register({
        type: body.type,
        url: body.url,
        target: body.target,
        events: body.events ?? [],
        minVerdict: body.minVerdict,
        throttlePerMin: body.throttlePerMin,
        createdBy: req.principal?.email ?? "admin",
      });
    } catch (e) {
      if (e instanceof NotificationError) throw new BadRequestException({ error: true, message: e.message });
      throw e;
    }
  }

  @Post(":id/test")
  @HttpCode(200)
  @ApiOperation({ summary: "Send a test alert", description: "Admin only. Posts a sample message to the channel to confirm it's wired up." })
  @ApiParam({ name: "id" })
  async test(@Param("id") id: string): Promise<{ ok: boolean; error?: string }> {
    try {
      return await this.notifications.test(id);
    } catch (e) {
      if (e instanceof NotificationError) throw new BadRequestException({ error: true, message: e.message });
      throw e;
    }
  }

  @Post(":id/revoke")
  @HttpCode(200)
  @ApiOperation({ summary: "Deactivate a channel", description: "Admin only. Stops further alerts to the channel." })
  @ApiParam({ name: "id" })
  async revoke(@Param("id") id: string): Promise<{ ok: true }> {
    await this.notifications.revoke(id);
    return { ok: true };
  }

  @Get("deliveries")
  @ApiOperation({
    summary: "List alert deliveries",
    description: "Admin only. Pending alert deliveries (awaiting a retry) and dead-lettered ones (exhausted their retries). Bodies are omitted.",
  })
  deliveries(): Promise<{ pending: NotificationDeliveryView[]; dead: NotificationDeliveryView[] }> {
    return this.queue.listDeliveries();
  }

  @Post("deliveries/redrive")
  @HttpCode(200)
  @ApiOperation({ summary: "Re-drive dead-lettered alerts", description: "Admin only. Moves every dead-lettered alert delivery back to the queue for another attempt." })
  async redrive(): Promise<{ requeued: number }> {
    return { requeued: await this.queue.redrive() };
  }
}
