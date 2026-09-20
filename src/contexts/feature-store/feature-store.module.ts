import { Module } from "@nestjs/common";
import { redisEnabled } from "@shared/adapters/redis.provider";
import { FEATURE_STORE_PORT } from "./application/feature-store.port";
import { InMemoryFeatureStore } from "./adapters/in-memory/in-memory-feature-store.adapter";
import { RedisFeatureStore } from "./adapters/redis/redis-feature-store.adapter";

/**
 * Feature Store context. Velocity counters live behind FEATURE_STORE_PORT; the in-memory
 * adapter serves dev, tests and single-node deploys, and the Redis adapter shares the counters
 * across replicas when REDIS_URL is set.
 */
@Module({
  providers: [{ provide: FEATURE_STORE_PORT, useClass: redisEnabled() ? RedisFeatureStore : InMemoryFeatureStore }],
  exports: [FEATURE_STORE_PORT],
})
export class FeatureStoreModule {}

export { FEATURE_STORE_PORT };
