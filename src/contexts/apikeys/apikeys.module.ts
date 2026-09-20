import { Global, Module } from "@nestjs/common";
import { API_KEY_VERIFIER } from "@shared/ports/api-key-verifier.port";
import { API_KEYS_PORT } from "./application/api-keys.port";
import { API_KEY_REPOSITORY_PORT } from "./application/api-key-repository.port";
import { ApiKeysService } from "./application/api-keys.service";
import { StoreApiKeyRepository } from "./adapters/store/store-api-key.repository";
import { ApiKeysController } from "./adapters/http/api-keys.controller";

/**
 * Global so API_KEY_VERIFIER is available wherever the shared ApiKeyGuard runs.
 * One service instance backs both the management port and the verifier.
 */
@Global()
@Module({
  controllers: [ApiKeysController],
  providers: [
    ApiKeysService,
    { provide: API_KEYS_PORT, useExisting: ApiKeysService },
    { provide: API_KEY_VERIFIER, useExisting: ApiKeysService },
    { provide: API_KEY_REPOSITORY_PORT, useClass: StoreApiKeyRepository },
  ],
  exports: [API_KEY_VERIFIER],
})
export class ApiKeysModule {}
