import { Module } from "@nestjs/common";
import { redisEnabled } from "@shared/adapters/redis.provider";
import { FEATURE_STORE_PORT } from "./application/feature-store.port";
import { GEO_RESOLVER, SyntheticGeoResolver } from "./domain/geo";
import { InMemoryFeatureStore } from "./adapters/in-memory/in-memory-feature-store.adapter";
import { RedisFeatureStore } from "./adapters/redis/redis-feature-store.adapter";

/**
 * Feature Store context. Velocity/identity/geo signals live behind FEATURE_STORE_PORT; the in-memory
 * adapter serves dev, tests and single-node deploys, and the Redis adapter shares state across
 * replicas when REDIS_URL is set. GEO_RESOLVER is the offline IP→location seam — swap the synthetic
 * resolver for a GeoIP-database adapter in production without touching either feature store.
 */
@Module({
  providers: [
    { provide: FEATURE_STORE_PORT, useClass: redisEnabled() ? RedisFeatureStore : InMemoryFeatureStore },
    { provide: GEO_RESOLVER, useClass: SyntheticGeoResolver },
  ],
  exports: [FEATURE_STORE_PORT],
})
export class FeatureStoreModule {}

export { FEATURE_STORE_PORT };
