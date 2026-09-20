import { SetMetadata } from "@nestjs/common";

export interface RateLimitOptions {
  /** Named budget resolved per request from RateLimitSettings (e.g. "decisions", "login") — so
   * the limit can be retuned from the dashboard without a redeploy. */
  readonly name: string;
  /** What to bucket by: the caller's API key, or their IP (for pre-auth endpoints like login). */
  readonly by: "apikey" | "ip";
}

export const RATE_LIMIT_KEY = "verdict:rate-limit";

/** Marks a handler for the RateLimitGuard. Ordering: place after the auth/key guard. */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);
