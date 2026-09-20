import { BadRequestException, Body, Controller, HttpCode, Post, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "@shared/adapters/auth.guard";
import { AdminGuard } from "@shared/adapters/admin.guard";
import { EraseDto } from "../../../../docs/api-dto";
import { ErasureService, type ErasureResult } from "../../application/erasure.service";

/** Data governance: an admin erases a user's personal data across the engine's stores. */
@ApiTags("Privacy")
@ApiBearerAuth("bearer")
@Controller("v1/privacy")
@UseGuards(AuthGuard, AdminGuard)
export class PrivacyController {
  constructor(private readonly erasure: ErasureService) {}

  @Post("erase")
  @HttpCode(200)
  @ApiOperation({ summary: "Erase a user's data", description: "Admin only. Right-to-erasure — removes the user's personal data across the engine's stores and returns what was affected." })
  @ApiBody({ type: EraseDto })
  erase(@Body("userId") userId?: string): Promise<ErasureResult> {
    if (!userId) throw new BadRequestException({ error: true, message: "userId is required" });
    return this.erasure.eraseUser(userId);
  }
}
