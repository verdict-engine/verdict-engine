import { Module } from "@nestjs/common";
import { FEEDBACK_PORT } from "./application/feedback.port";
import { FeedbackService } from "./application/feedback.service";
import { FeedbackController } from "./adapters/http/feedback.controller";
import { StoreFeedback } from "./adapters/store/store-feedback.adapter";

@Module({
  controllers: [FeedbackController],
  providers: [
    FeedbackService,
    { provide: FEEDBACK_PORT, useClass: StoreFeedback },
  ],
  exports: [FEEDBACK_PORT],
})
export class FeedbackModule {}

export { FEEDBACK_PORT };
