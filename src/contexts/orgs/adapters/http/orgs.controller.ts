import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  HttpCode,
  Post,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminGuard } from "@shared/adapters/admin.guard";
import { DomainError } from "@shared/domain/result";
import type { Org } from "../../domain/org";
import type { UserSummary } from "@contexts/auth/application/auth.port";
import { OrgsService } from "../../application/orgs.service";

interface CreateOrgBody {
  name?: string;
  adminEmail?: string;
  adminPassword?: string;
}

/** Tenant management — root-org admins only (enforced in the service). */
@ApiTags("Orgs")
@Controller("v1/orgs")
@UseGuards(AdminGuard)
@ApiBearerAuth("bearer")
export class OrgsController {
  constructor(private readonly orgs: OrgsService) {}

  @Get()
  @ApiOperation({ summary: "List tenants", description: "Root org only. Lists every org." })
  list(): Promise<Org[]> {
    return this.guarded(() => this.orgs.list());
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({
    summary: "Provision a tenant",
    description: "Root org only. Creates an org and its first admin operator in one step.",
  })
  create(@Body() body: CreateOrgBody): Promise<{ org: Org; admin: UserSummary }> {
    if (!body.name || !body.adminEmail || !body.adminPassword) {
      throw new BadRequestException({ error: true, message: "name, adminEmail and adminPassword are required" });
    }
    return this.guarded(() => this.orgs.provision(body.name as string, body.adminEmail as string, body.adminPassword as string));
  }

  private async guarded<T>(op: () => Promise<T>): Promise<T> {
    try {
      return await op();
    } catch (e) {
      if (e instanceof DomainError) {
        if (e.code === "FORBIDDEN") throw new ForbiddenException({ error: true, code: e.code, message: e.message });
        throw new BadRequestException({ error: true, code: e.code, message: e.message });
      }
      throw e;
    }
  }
}
