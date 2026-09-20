import { Module } from "@nestjs/common";
import { RetentionController } from "./adapters/http/retention.controller";
import { PruneService } from "./application/prune.service";
import { RETENTION_SETTINGS, RetentionSettings } from "./application/retention-settings";

/**
 * Data retention: the scheduled prune job that bounds the append-only collections, plus the
 * operator-editable retention windows behind it. Self-contained — it reads only the shared Store,
 * Clock and its own settings.
 */
@Module({
  controllers: [RetentionController],
  providers: [PruneService, { provide: RETENTION_SETTINGS, useClass: RetentionSettings }],
})
export class RetentionModule {}
