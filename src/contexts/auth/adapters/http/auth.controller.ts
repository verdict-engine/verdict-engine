import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  ForbiddenException,
  Get,
  Headers,
  HttpCode,
  Inject,
  Post,
  UnauthorizedException,
  UseGuards,
} from "@nestjs/common";
import { ApiBearerAuth, ApiBody, ApiOkResponse, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AdminGuard } from "@shared/adapters/admin.guard";
import { AuthGuard } from "@shared/adapters/auth.guard";
import { RateLimitGuard } from "@shared/adapters/rate-limit.guard";
import { RateLimit } from "@shared/adapters/rate-limit.decorator";
import { AuthResultDto, AuthStatusDto, CreateUserDto, CredentialsDto } from "../../../../docs/api-dto";
import { DomainError } from "@shared/domain/result";
import type { Role } from "../../domain/user";
import {
  AUTH_PORT,
  type AuthPort,
  type AuthResult,
  type UserSummary,
} from "../../application/auth.port";

interface Credentials {
  email?: string;
  password?: string;
  role?: string;
}

@ApiTags("Auth")
@Controller("v1/auth")
export class AuthController {
  constructor(@Inject(AUTH_PORT) private readonly auth: AuthPort) {}

  @Get("status")
  @ApiOperation({ summary: "Auth bootstrap status", description: "Public. Tells the dashboard whether the very first admin still needs to be created." })
  @ApiOkResponse({ type: AuthStatusDto })
  status(): Promise<{ needsBootstrap: boolean }> {
    return this.auth.status();
  }

  @Post("register")
  @HttpCode(201)
  @ApiOperation({ summary: "Bootstrap the first admin", description: "Public, but only works while no users exist — it creates the first user as an admin. Returns 403 once any user exists." })
  @ApiBody({ type: CredentialsDto })
  @ApiOkResponse({ type: AuthResultDto, description: "Created — includes a bearer token." })
  register(@Body() body: Credentials): Promise<AuthResult> {
    return this.guarded(body, () => this.auth.register(body.email as string, body.password as string));
  }

  @Post("login")
  @HttpCode(200)
  @UseGuards(RateLimitGuard)
  @ApiOperation({ summary: "Log in", description: "Exchange email + password for a bearer token (valid 12h). Rate-limited per IP." })
  @ApiBody({ type: CredentialsDto })
  @ApiOkResponse({ type: AuthResultDto })
  @RateLimit({ name: "login", by: "ip" })
  login(@Body() body: Credentials): Promise<AuthResult> {
    return this.guarded(body, () => this.auth.login(body.email as string, body.password as string));
  }

  @Post("logout")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth("bearer")
  @ApiOperation({ summary: "Log out", description: "Revokes the presented token so it can no longer be used, even before it expires." })
  async logout(@Headers("authorization") authorization?: string): Promise<{ ok: true }> {
    await this.auth.logout(bearer(authorization));
    return { ok: true };
  }

  @Post("logout-all")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth("bearer")
  @ApiOperation({ summary: "Log out everywhere", description: "Revokes every active session for the current user (e.g. after a suspected compromise)." })
  async logoutAll(@Headers("authorization") authorization?: string): Promise<{ ok: true }> {
    await this.auth.logoutAll(bearer(authorization));
    return { ok: true };
  }

  @Post("refresh")
  @HttpCode(200)
  @UseGuards(AuthGuard)
  @ApiBearerAuth("bearer")
  @ApiOperation({ summary: "Refresh the token", description: "Exchanges a still-valid token for a fresh one (sliding session). The old token remains valid until it expires." })
  @ApiOkResponse({ type: AuthResultDto })
  refresh(@Headers("authorization") authorization?: string): Promise<AuthResult> {
    return this.auth.refresh(bearer(authorization));
  }

  @Get("users")
  @UseGuards(AdminGuard)
  @ApiBearerAuth("bearer")
  @ApiOperation({ summary: "List operators", description: "Admin only." })
  listUsers(): Promise<UserSummary[]> {
    return this.auth.listUsers();
  }

  @Post("users")
  @UseGuards(AdminGuard)
  @HttpCode(201)
  @ApiBearerAuth("bearer")
  @ApiOperation({ summary: "Create an operator", description: "Admin only. Creates an additional operator (analyst by default)." })
  @ApiBody({ type: CreateUserDto })
  createUser(@Body() body: Credentials): Promise<UserSummary> {
    const role: Role = body.role === "admin" ? "admin" : "analyst";
    return this.guarded(body, () => this.auth.createUser(body.email as string, body.password as string, role));
  }

  private async guarded<T>(body: Credentials, op: () => Promise<T>): Promise<T> {
    if (!body.email || !body.password) {
      throw new BadRequestException({ error: true, message: "email and password are required" });
    }
    try {
      return await op();
    } catch (e) {
      if (e instanceof DomainError) {
        if (e.code === "INVALID_CREDENTIALS") throw new UnauthorizedException({ error: true, code: e.code });
        if (e.code === "REGISTRATION_CLOSED") throw new ForbiddenException({ error: true, code: e.code, message: e.message });
        if (e.code === "EMAIL_TAKEN") throw new ConflictException({ error: true, code: e.code });
        throw new BadRequestException({ error: true, code: e.code, message: e.message });
      }
      throw e;
    }
  }
}

/** The token from an `Authorization: Bearer …` header (the AuthGuard has already validated it). */
function bearer(authorization?: string): string {
  return authorization?.startsWith("Bearer ") ? authorization.slice(7) : "";
}
