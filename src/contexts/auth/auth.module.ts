import { Global, Module } from "@nestjs/common";
import { TOKEN_VERIFIER } from "@shared/ports/token-verifier.port";
import { AUTH_PORT } from "./application/auth.port";
import { USER_REPOSITORY_PORT } from "./application/user-repository.port";
import { AuthService } from "./application/auth.service";
import { TOKEN_CONFIG, buildTokenConfig } from "./application/token-config";
import { StoreUserRepository } from "./adapters/store/store-user.repository";
import { AuthController } from "./adapters/http/auth.controller";

/**
 * Global so TOKEN_VERIFIER is available wherever the shared AuthGuard runs.
 * One AuthService instance backs both the inbound auth port and the token verifier.
 */
@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    { provide: TOKEN_CONFIG, useFactory: () => buildTokenConfig() },
    { provide: AUTH_PORT, useExisting: AuthService },
    { provide: TOKEN_VERIFIER, useExisting: AuthService },
    { provide: USER_REPOSITORY_PORT, useClass: StoreUserRepository },
  ],
  exports: [AUTH_PORT, TOKEN_VERIFIER],
})
export class AuthModule {}
