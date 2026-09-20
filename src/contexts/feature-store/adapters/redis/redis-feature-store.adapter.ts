import { Inject, Injectable } from "@nestjs/common";
import { Redis } from "ioredis";
import { CLOCK, type Clock } from "@shared/ports/clock.port";
import { REDIS } from "@shared/adapters/redis.provider";
import type { RiskEvent } from "@contexts/ingest/application/ingest.port";
import type { FeatureSnapshot, FeatureStorePort } from "../../application/feature-store.port";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEVICE_TTL_MS = 30 * DAY_MS;

/**
 * Redis-backed FeatureStore — shared velocity across replicas, so counters are whole no matter
 * which node a request lands on. Per-user attempts live in a sorted set scored by time (trimmed
 * to 24h); users-per-device in a set. `snapshot` reflects state before the current event; `record`
 * folds it in. Same contract and window semantics as the in-memory adapter.
 */
@Injectable()
export class RedisFeatureStore implements FeatureStorePort {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async snapshot(event: RiskEvent): Promise<FeatureSnapshot> {
    const now = this.clock.now().getTime();
    const members = await this.redis.zrangebyscore(velKey(event), now - DAY_MS, now);
    const attempts = members.map(parseAttempt);
    const within = (ms: number) => attempts.filter((a) => now - a.at <= ms);

    const deviceId = event.subject.deviceId;
    let usersOnDevice = 0;
    let firstSeen = false;
    if (deviceId) {
      usersOnDevice = await this.redis.scard(devKey(deviceId));
      firstSeen = (await this.redis.exists(devKey(deviceId))) === 0;
    }

    return {
      velocity: {
        attemptsLast2m: within(2 * 60_000).length,
        attemptsLast24h: within(DAY_MS).length,
        amountLast1h: within(60 * 60_000).reduce((sum, a) => sum + a.amount, 0),
      },
      device: { firstSeen, usersOnDevice },
      geo: { ipSimMismatch: event.attributes.geoMismatch === true },
    };
  }

  async record(event: RiskEvent): Promise<void> {
    const now = this.clock.now().getTime();
    const key = velKey(event);
    const member = `${now}|${event.money?.amount ?? 0}|${Math.random().toString(36).slice(2, 8)}`;
    // MULTI/EXEC applies the whole fold atomically in one round-trip — no other command interleaves
    // between the add, the trim and the expiry, and no partial state is left if one step is late.
    const tx = this.redis
      .multi()
      .zadd(key, now, member)
      .zremrangebyscore(key, 0, now - DAY_MS)
      .pexpire(key, DAY_MS);

    const deviceId = event.subject.deviceId;
    if (deviceId) {
      tx.sadd(devKey(deviceId), event.subject.userId).pexpire(devKey(deviceId), DEVICE_TTL_MS);
    }
    await tx.exec();
  }
}

const velKey = (event: RiskEvent): string => `vel:${event.subject.userId}`;
const devKey = (deviceId: string): string => `dev:${deviceId}`;

function parseAttempt(member: string): { at: number; amount: number } {
  const [at, amount] = member.split("|");
  return { at: Number(at), amount: Number(amount) };
}
