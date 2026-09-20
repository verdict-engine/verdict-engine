import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  NotFoundException,
  Param,
  Post,
  Req,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiParam, ApiTags } from "@nestjs/swagger";
import { AdminGuard } from "@shared/adapters/admin.guard";
import { DomainError } from "@shared/domain/result";
import type { Principal } from "@shared/ports/token-verifier.port";
import { CreateApiKeyDto } from "../../../../docs/api-dto";
import { API_KEYS_PORT, type ApiKeysPort, type CreatedKey } from "../../application/api-keys.port";
import type { ApiKeySummary } from "../../domain/api-key";

interface AdminRequest {
  principal?: Principal;
}

interface CreateKeyBody {
  name?: string;
  scopes?: string[];
  expiresInDays?: number;
}

@ApiTags("API keys")
@ApiBearerAuth("bearer")
@Controller("v1/apikeys")
@UseGuards(AdminGuard)
export class ApiKeysController {
  constructor(@Inject(API_KEYS_PORT) private readonly keys: ApiKeysPort) {}

  @Get()
  @ApiOperation({ summary: "List API keys", description: "Admin only. Metadata only — the secret is shown once at creation and stored hashed." })
  list(): Promise<ApiKeySummary[]> {
    return this.keys.list();
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: "Create an API key", description: "Admin only. Optionally scope it (decisions/labels) and set an expiry. Returns the plaintext secret exactly once — store it now; it cannot be retrieved again." })
  @ApiBody({ type: CreateApiKeyDto })
  async create(@Body() body: CreateKeyBody, @Req() req: AdminRequest): Promise<CreatedKey> {
    if (!body?.name) throw new BadRequestException({ error: true, message: "name is required" });
    try {
      return await this.keys.create(body.name, req.principal?.email ?? "admin", {
        scopes: body.scopes,
        expiresInDays: body.expiresInDays,
      });
    } catch (e) {
      if (e instanceof DomainError && e.code.startsWith("API_KEY_")) {
        throw new BadRequestException({ error: true, code: e.code, message: e.message });
      }
      throw e;
    }
  }

  @Post(":id/revoke")
  @HttpCode(200)
  @ApiOperation({ summary: "Revoke an API key", description: "Admin only. Immediately disables the key." })
  @ApiParam({ name: "id" })
  async revoke(@Param("id") id: string): Promise<{ ok: true }> {
    try {
      await this.keys.revoke(id);
      return { ok: true };
    } catch (e) {
      if (e instanceof DomainError && e.code === "API_KEY_NOT_FOUND") {
        throw new NotFoundException({ error: true, code: e.code });
      }
      throw e;
    }
  }
}
