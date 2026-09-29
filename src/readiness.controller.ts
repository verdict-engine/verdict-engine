import { Controller, Get, Inject, Optional, ServiceUnavailableException } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import type { Redis } from "ioredis";
import { STORE, type Store } from "@shared/ports/store.port";
import { REDIS } from "@shared/adapters/redis.provider";
import { APP_VERSION } from "./version";

interface ReadyChecks {
  store: "ok" | "down";
  redis: "ok" | "down" | "skipped";
}

/**
 * Readiness probe — distinct from the liveness `/health`. It verifies the datastore is reachable
 * (the query hits the `documents` table, so a missing schema / unfinished migration also fails it)
 * and, when Redis is configured, that Redis answers. Returns 503 until the instance can actually
 * serve durable decisions, so a load balancer / orchestrator holds traffic until then. `/health`
 * remains a pure liveness signal that the process is up.
 */
@ApiTags("Health")
@Controller()
export class ReadinessController {
  constructor(
    @Inject(STORE) private readonly store: Store,
    @Optional() @Inject(REDIS) private readonly redis?: Redis,
  ) {}

  @Get("readyz")
  @ApiOperation({
    summary: "Readiness probe",
    description:
      "Verifies the datastore (and Redis when configured) are reachable before this instance serves traffic. Returns 503 until ready.",
  })
  async readyz(): Promise<{ status: "ready"; version: string; checks: ReadyChecks }> {
    const checks: ReadyChecks = { store: "down", redis: "skipped" };

    try {
      await this.store.collection<unknown>("_readiness").get("_probe");
      checks.store = "ok";
    } catch {
      checks.store = "down";
    }

    if (this.redis) {
      try {
        await this.redis.ping();
        checks.redis = "ok";
      } catch {
        checks.redis = "down";
      }
    }

    const ready = checks.store === "ok" && checks.redis !== "down";
    if (!ready) {
      // Fail closed with a 503; the body says which dependency is down, never why (no internals leak).
      throw new ServiceUnavailableException({ status: "not_ready", version: APP_VERSION, checks });
    }
    return { status: "ready", version: APP_VERSION, checks };
  }
}
