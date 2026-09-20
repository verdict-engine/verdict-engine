import { Module } from "@nestjs/common";
import { ANOMALY_PORT } from "./application/anomaly.port";
import { AnomalyService } from "./application/anomaly.service";

@Module({
  providers: [
    AnomalyService,
    { provide: ANOMALY_PORT, useExisting: AnomalyService },
  ],
  exports: [ANOMALY_PORT],
})
export class AnomalyModule {}

export { ANOMALY_PORT };
