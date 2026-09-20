import { Module } from "@nestjs/common";
import { AuditController } from "./adapters/http/audit.controller";

/** Read side of the audit trail. The AuditLog itself lives in the shared kernel (written by the
 * audit interceptor); this just exposes it to admins. */
@Module({
  controllers: [AuditController],
})
export class AuditModule {}
