import { Module } from "@nestjs/common";
import { INGEST_PORT } from "./application/ingest.port";
import { IngestService } from "./application/ingest.service";

/**
 * Ingest context. Owns the RiskEvent shape and validation, exports INGEST_PORT.
 */
@Module({
  providers: [{ provide: INGEST_PORT, useClass: IngestService }],
  exports: [INGEST_PORT],
})
export class IngestModule {}

export { INGEST_PORT };
