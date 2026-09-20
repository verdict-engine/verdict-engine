import { Inject, Injectable } from "@nestjs/common";
import { Redis } from "ioredis";
import type { RateDecision, RateLimiter } from "../ports/rate-limiter.port";
import { REDIS } from "./redis.provider";

/**
 * Fixed-window limiter shared across replicas via Redis: INCR a per-window key and expire it
 * after the window. The count is authoritative for every replica, so N replicas enforce one budget.
 */
@Injectable()
export class RedisRateLimiter implements RateLimiter {
  constructor(@Inject(REDIS) private readonly redis: Redis) {}

  async take(key: string, limit: number, windowMs: number): Promise<RateDecision> {
    const k = `rl:${key}`;
    const count = await this.redis.incr(k);
    if (count === 1) await this.redis.pexpire(k, windowMs);

    const allowed = count <= limit;
    let retryAfterMs = 0;
    if (!allowed) {
      const ttl = await this.redis.pttl(k);
      retryAfterMs = ttl > 0 ? ttl : windowMs;
    }
    return { allowed, remaining: Math.max(0, limit - count), retryAfterMs };
  }
}
