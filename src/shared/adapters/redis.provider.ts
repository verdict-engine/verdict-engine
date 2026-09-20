import { Redis } from "ioredis";

export const REDIS = Symbol("Redis");

/** Whether Redis-backed adapters should be used (shared counters across replicas). */
export const redisEnabled = (): boolean => Boolean(process.env.REDIS_URL);

/**
 * One shared Redis connection, or undefined when REDIS_URL is unset (single-node, in-memory
 * adapters). Bound globally so the rate limiter, idempotency store and feature store share it.
 */
export function createRedis(): Redis | undefined {
  const url = process.env.REDIS_URL;
  if (!url) return undefined;
  return new Redis(url, { maxRetriesPerRequest: 3 });
}
