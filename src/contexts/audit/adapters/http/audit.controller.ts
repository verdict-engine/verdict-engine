import { Controller, Get, Inject, Query, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from "@nestjs/swagger";
import { AdminGuard } from "@shared/adapters/admin.guard";
import { AUDIT_LOG, type AuditLog, type AuditPage } from "@shared/adapters/audit-log";

const MAX_LIMIT = 200;

@ApiTags("Audit")
@ApiBearerAuth("bearer")
@Controller("v1/audit")
@UseGuards(AdminGuard)
export class AuditController {
  constructor(@Inject(AUDIT_LOG) private readonly audit: AuditLog) {}

  @Get()
  @ApiOperation({
    summary: "List the config-change audit trail",
    description: "Admin only. Newest-first, paginated record of every operator mutation (who, what, when) with secret-ish request fields redacted.",
  })
  @ApiQuery({ name: "limit", required: false, description: "Page size (default 50, max 200)." })
  @ApiQuery({ name: "offset", required: false, description: "Rows to skip (default 0)." })
  list(@Query("limit") limit?: string, @Query("offset") offset?: string): Promise<AuditPage> {
    const n = Math.min(MAX_LIMIT, Math.max(1, Number(limit) || 50));
    const skip = Math.max(0, Number(offset) || 0);
    return this.audit.list(n, skip);
  }
}
