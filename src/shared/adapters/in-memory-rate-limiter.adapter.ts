import { Injectable } from "@nestjs/common";
import type { RateDecision, RateLimiter } from "../ports/rate-limiter.port";

interface Window {
  count: number;
  resetAt: number;
}

/**
 * In-memory fixed-window limiter. Per-process, so behind N replicas the effective limit is
 * N× — swap for a Redis adapter to share a window. Idle keys are swept lazily on access.
 */
@Injectable()
export class InMemoryRateLimiter implements RateLimiter {
  private readonly windows = new Map<string, Window>();

  async take(key: string, limit: number, windowMs: number): Promise<RateDecision> {
    const now = Date.now();
    const existing = this.windows.get(key);
    const window = existing && existing.resetAt > now ? existing : { count: 0, resetAt: now + windowMs };

    window.count += 1;
    this.windows.set(key, window);
    if (this.windows.size > 10_000) this.sweep(now);

    const allowed = window.count <= limit;
    return {
      allowed,
      remaining: Math.max(0, limit - window.count),
      retryAfterMs: allowed ? 0 : window.resetAt - now,
    };
  }

  private sweep(now: number): void {
    for (const [key, w] of this.windows) if (w.resetAt <= now) this.windows.delete(key);
  }
}
