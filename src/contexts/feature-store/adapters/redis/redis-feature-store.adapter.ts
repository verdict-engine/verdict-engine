import { Inject, Injectable } from "@nestjs/common";
import { Redis } from "ioredis";
import { CLOCK, type Clock } from "@shared/ports/clock.port";
import { REDIS } from "@shared/adapters/redis.provider";
import type { RiskEvent } from "@contexts/ingest/application/ingest.port";
import type { FeatureSnapshot, FeatureStorePort } from "../../application/feature-store.port";
import { GEO_RESOLVER, type GeoResolver, type GeoLocation, haversineKm, isImpossibleTravel } from "../../domain/geo";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEVICE_TTL_MS = 30 * DAY_MS;

/**
 * Redis-backed FeatureStore — shared velocity/identity across replicas, so counters are whole no
 * matter which node a request lands on. Per-user attempts live in a sorted set scored by time
 * (trimmed to 24h); users-per-device/fingerprint in sets; last location in a small JSON string.
 * `snapshot` reflects state before the current event; `record` folds it in. Same contract and window
 * semantics as the in-memory adapter.
 */
@Injectable()
export class RedisFeatureStore implements FeatureStorePort {
  constructor(
    @Inject(REDIS) private readonly redis: Redis,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(GEO_RESOLVER) private readonly geo: GeoResolver,
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

    const fp = event.subject.fingerprint;
    let usersOnFingerprint = 0;
    let fingerprintFirstSeen = false;
    let fingerprintDeviceMismatch = false;
    if (fp) {
      usersOnFingerprint = await this.redis.scard(fpKey(fp));
      fingerprintFirstSeen = (await this.redis.exists(fpKey(fp))) === 0;
      if (deviceId) {
        const devices = await this.redis.smembers(fpDevKey(fp));
        fingerprintDeviceMismatch = devices.some((d) => d !== deviceId);
      }
    }

    return {
      velocity: {
        attemptsLast2m: within(2 * 60_000).length,
        attemptsLast24h: within(DAY_MS).length,
        amountLast1h: within(60 * 60_000).reduce((sum, a) => sum + a.amount, 0),
      },
      device: { firstSeen, usersOnDevice, fingerprintFirstSeen, usersOnFingerprint, fingerprintDeviceMismatch },
      geo: await this.geoFeatures(event, now),
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
    const fp = event.subject.fingerprint;
    if (fp) {
      tx.sadd(fpKey(fp), event.subject.userId).pexpire(fpKey(fp), DEVICE_TTL_MS);
      if (deviceId) tx.sadd(fpDevKey(fp), deviceId).pexpire(fpDevKey(fp), DEVICE_TTL_MS);
    }
    const loc = this.geo.resolve(event.subject.ip);
    if (loc) tx.set(locKey(event), JSON.stringify({ ...loc, at: now }), "PX", DEVICE_TTL_MS);
    await tx.exec();
  }

  private async geoFeatures(event: RiskEvent, now: number): Promise<FeatureSnapshot["geo"]> {
    const here = this.geo.resolve(event.subject.ip);
    const ipSimMismatch = event.attributes.geoMismatch === true;
    if (!here) return { ipSimMismatch, impossibleTravel: false, countryChanged: false };
    const raw = await this.redis.get(locKey(event));
    const last = raw ? (JSON.parse(raw) as GeoLocation & { at: number }) : null;
    if (!last) return { ipSimMismatch, country: here.country, impossibleTravel: false, countryChanged: false };
    const distanceKm = Math.round(haversineKm(last, here));
    return {
      ipSimMismatch,
      country: here.country,
      distanceKm,
      impossibleTravel: isImpossibleTravel(distanceKm, now - last.at),
      countryChanged: last.country !== here.country,
    };
  }
}

const velKey = (event: RiskEvent): string => `vel:${event.subject.userId}`;
const devKey = (deviceId: string): string => `dev:${deviceId}`;
const fpKey = (fp: string): string => `fp:${fp}`;
const fpDevKey = (fp: string): string => `fpdev:${fp}`;
const locKey = (event: RiskEvent): string => `loc:${event.subject.userId}`;

function parseAttempt(member: string): { at: number; amount: number } {
  const [at, amount] = member.split("|");
  return { at: Number(at), amount: Number(amount) };
}
