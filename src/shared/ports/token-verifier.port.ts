export interface Principal {
  readonly userId: string;
  readonly email: string;
  readonly role: string;
}

/**
 * Verifies a bearer token into a principal. Defined in shared so any context can
 * require auth through the guard; the auth context implements it. Shared stays
 * free of business logic — this is a contract, not an implementation. Async because
 * verification includes a revocation check against durable state.
 */
export interface TokenVerifier {
  verify(token: string): Promise<Principal | null>;
}

export const TOKEN_VERIFIER = Symbol("TokenVerifier");
