import { SetMetadata } from "@nestjs/common";

export const API_KEY_SCOPE_KEY = "verdict:api-key-scope";

/** Require the presented API key to carry this scope. Read by ApiKeyGuard. */
export const RequireApiScope = (scope: string) => SetMetadata(API_KEY_SCOPE_KEY, scope);
