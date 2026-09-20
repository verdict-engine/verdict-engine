export interface ApiKeyPrincipal {
  readonly id: string;
  readonly name: string;
  /** Scopes this key grants — the guard checks the endpoint's required scope against these. */
  readonly scopes: string[];
}

/**
 * Verifies a service API key. Defined in shared so the request-path endpoints
 * (/v1/decisions, webhooks) can require a key through the guard; the apikeys
 * context implements it. Shared holds no business logic — this is a contract.
 */
export interface ApiKeyVerifier {
  verify(key: string): Promise<ApiKeyPrincipal | null>;
}

export const API_KEY_VERIFIER = Symbol("ApiKeyVerifier");
