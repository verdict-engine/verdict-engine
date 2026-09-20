import { Module } from "@nestjs/common";
import { WEBHOOKS_PORT, WEBHOOK_DELIVERY_PORT, WEBHOOK_QUEUE_PORT } from "./application/webhooks.port";
import { WebhooksService } from "./application/webhooks.service";
import { WebhookRelay } from "./application/webhook-relay.service";
import { HttpWebhookDelivery } from "./adapters/http/webhook-delivery.adapter";
import { WebhooksController } from "./adapters/http/webhooks.controller";

@Module({
  controllers: [WebhooksController],
  providers: [
    WebhooksService,
    WebhookRelay,
    { provide: WEBHOOKS_PORT, useExisting: WebhooksService },
    { provide: WEBHOOK_QUEUE_PORT, useExisting: WebhookRelay },
    { provide: WEBHOOK_DELIVERY_PORT, useClass: HttpWebhookDelivery },
  ],
})
export class WebhooksModule {}
