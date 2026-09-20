import { Module } from "@nestjs/common";
import { NOTIFICATIONS_PORT, NOTIFICATION_DELIVERY_PORT, NOTIFICATION_QUEUE_PORT } from "./application/notifications.port";
import { NotificationsService } from "./application/notifications.service";
import { NotificationRelay } from "./application/notification-relay.service";
import { HttpNotificationDelivery } from "./adapters/http/notification-delivery.adapter";
import { NotificationsController } from "./adapters/http/notifications.controller";

@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationRelay,
    { provide: NOTIFICATIONS_PORT, useExisting: NotificationsService },
    { provide: NOTIFICATION_QUEUE_PORT, useExisting: NotificationRelay },
    { provide: NOTIFICATION_DELIVERY_PORT, useClass: HttpNotificationDelivery },
  ],
})
export class NotificationsModule {}
