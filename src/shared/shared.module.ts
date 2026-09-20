import { Global, Module } from "@nestjs/common";
import { APP_INTERCEPTOR } from "@nestjs/core";
import { InProcessEventBus } from "./adapters/in-process-event-bus.adapter";
import { MonotonicIdGenerator } from "./adapters/monotonic-id-generator.adapter";
import { SystemClock } from "./adapters/system-clock.adapter";
import { MemoryStore } from "./adapters/memory-store.adapter";
import { PgStore } from "./adapters/pg-store.adapter";
import { InMemoryRateLimiter } from "./adapters/in-memory-rate-limiter.adapter";
import { RedisRateLimiter } from "./adapters/redis-rate-limiter.adapter";
import { RATE_LIMIT_SETTINGS, RateLimitSettings } from "./adapters/rate-limit-settings";
import { ALERT_SETTINGS, AlertSettings } from "./adapters/alert-settings";
import { AUDIT_LOG, AuditLog } from "./adapters/audit-log";
import { AuditInterceptor } from "./adapters/audit.interceptor";
import { REDIS, createRedis, redisEnabled } from "./adapters/redis.provider";
import { AuthGuard } from "./adapters/auth.guard";
import { AdminGuard } from "./adapters/admin.guard";
import { ApiKeyGuard } from "./adapters/api-key.guard";
import { RateLimitGuard } from "./adapters/rate-limit.guard";
import { CLOCK } from "./ports/clock.port";
import { EVENT_BUS } from "./ports/event-bus.port";
import { ID_GENERATOR } from "./ports/id-generator.port";
import { RATE_LIMITER } from "./ports/rate-limiter.port";
import { STORE, type Store } from "./ports/store.port";

const underTest =
  process.env.PERSISTENCE === "memory" ||
  process.env.VITEST === "true" ||
  process.env.NODE_ENV === "test";

// Postgres when DATABASE_URL is set; in-memory under test, or in dev without a DB.
function createStore(): Store {
  if (underTest) return new MemoryStore();
  if (process.env.DATABASE_URL) return new PgStore();
  // eslint-disable-next-line no-console
  console.warn("[verdict] DATABASE_URL not set — using the in-memory store; data will NOT persist. Set DATABASE_URL for Postgres.");
  return new MemoryStore();
}

/** The shared kernel, exported globally: cross-cutting ports every context relies on. */
@Global()
@Module({
  providers: [
    { provide: EVENT_BUS, useClass: InProcessEventBus },
    { provide: CLOCK, useClass: SystemClock },
    { provide: ID_GENERATOR, useClass: MonotonicIdGenerator },
    { provide: STORE, useFactory: createStore },
    { provide: REDIS, useFactory: createRedis },
    { provide: RATE_LIMITER, useClass: redisEnabled() ? RedisRateLimiter : InMemoryRateLimiter },
    { provide: RATE_LIMIT_SETTINGS, useClass: RateLimitSettings },
    { provide: ALERT_SETTINGS, useClass: AlertSettings },
    { provide: AUDIT_LOG, useClass: AuditLog },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    AuthGuard,
    AdminGuard,
    ApiKeyGuard,
    RateLimitGuard,
  ],
  exports: [EVENT_BUS, CLOCK, ID_GENERATOR, STORE, REDIS, RATE_LIMITER, RATE_LIMIT_SETTINGS, ALERT_SETTINGS, AUDIT_LOG, AuthGuard, AdminGuard, ApiKeyGuard, RateLimitGuard],
})
export class SharedModule {}
