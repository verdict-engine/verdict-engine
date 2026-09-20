import { Module } from "@nestjs/common";
import { SettingsController } from "./adapters/http/settings.controller";

/** Runtime, operator-editable engine settings (rate limits today). Backed by RateLimitSettings in the shared kernel. */
@Module({
  controllers: [SettingsController],
})
export class SettingsModule {}
