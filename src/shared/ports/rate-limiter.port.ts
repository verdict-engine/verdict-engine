export interface RateDecision {
  readonly allowed: boolean;
  readonly remaining: number;
  readonly retryAfterMs: number;
}

/**
 * A fixed-window counter keyed by an arbitrary string. The default adapter is in-memory
 * (per-process); a Redis adapter implements the same port to share limits across replicas.
 */
export interface RateLimiter {
  take(key: string, limit: number, windowMs: number): Promise<RateDecision>;
}

export const RATE_LIMITER = Symbol("RateLimiter");
