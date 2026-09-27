import { Inject, Injectable } from "@nestjs/common";
import { CLOCK, type Clock } from "@shared/ports/clock.port";
import type { RiskEvent } from "@contexts/ingest/application/ingest.port";
import type {
  FeatureSnapshot,
  FeatureStorePort,
} from "../../application/feature-store.port";
import { GEO_RESOLVER, type GeoResolver, haversineKm, isImpossibleTravel } from "../../domain/geo";

interface Attempt {
  readonly at: number;
  readonly amount: number;
}

interface LastLocation {
  readonly country: string;
  readonly lat: number;
  readonly lon: number;
  readonly at: number;
}

/**
 * In-memory FeatureStore — the default adapter for local/dev/tests, same contract as
 * the Redis adapter. `snapshot` reflects state BEFORE the current event; `record` folds
 * the event in for subsequent decisions. The orchestrator calls snapshot, then record.
 */
@Injectable()
export class InMemoryFeatureStore implements FeatureStorePort {
  private readonly attemptsByUser = new Map<string, Attempt[]>();
  private readonly usersByDevice = new Map<string, Set<string>>();
  private readonly seenDevices = new Set<string>();
  private readonly usersByFingerprint = new Map<string, Set<string>>();
  private readonly devicesByFingerprint = new Map<string, Set<string>>();
  private readonly seenFingerprints = new Set<string>();
  private readonly lastLocationByUser = new Map<string, LastLocation>();

  constructor(
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(GEO_RESOLVER) private readonly geo: GeoResolver,
  ) {}

  async snapshot(event: RiskEvent): Promise<FeatureSnapshot> {
    const now = this.clock.now().getTime();
    const attempts = this.attemptsByUser.get(event.subject.userId) ?? [];
    const within = (ms: number) => attempts.filter((a) => now - a.at <= ms);

    const deviceId = event.subject.deviceId;
    const usersOnDevice = deviceId ? (this.usersByDevice.get(deviceId)?.size ?? 0) : 0;
    const firstSeen = deviceId ? !this.seenDevices.has(deviceId) : false;

    const fp = event.subject.fingerprint;
    const usersOnFingerprint = fp ? (this.usersByFingerprint.get(fp)?.size ?? 0) : 0;
    const fingerprintFirstSeen = fp ? !this.seenFingerprints.has(fp) : false;
    const fpDevices = fp ? this.devicesByFingerprint.get(fp) : undefined;
    const fingerprintDeviceMismatch = !!(fp && deviceId && fpDevices && [...fpDevices].some((d) => d !== deviceId));

    return {
      velocity: {
        attemptsLast2m: within(2 * 60_000).length,
        attemptsLast24h: within(24 * 60 * 60_000).length,
        amountLast1h: within(60 * 60_000).reduce((s, a) => s + a.amount, 0),
      },
      device: { firstSeen, usersOnDevice, fingerprintFirstSeen, usersOnFingerprint, fingerprintDeviceMismatch },
      geo: this.geoFeatures(event, now),
    };
  }

  async record(event: RiskEvent): Promise<void> {
    const now = this.clock.now().getTime();
    const list = this.attemptsByUser.get(event.subject.userId) ?? [];
    list.push({ at: now, amount: event.money?.amount ?? 0 });
    this.attemptsByUser.set(event.subject.userId, this.prune(list, now));

    const deviceId = event.subject.deviceId;
    if (deviceId) {
      this.addTo(this.usersByDevice, deviceId, event.subject.userId);
      this.seenDevices.add(deviceId);
    }
    const fp = event.subject.fingerprint;
    if (fp) {
      this.addTo(this.usersByFingerprint, fp, event.subject.userId);
      if (deviceId) this.addTo(this.devicesByFingerprint, fp, deviceId);
      this.seenFingerprints.add(fp);
    }
    const loc = this.geo.resolve(event.subject.ip);
    if (loc) this.lastLocationByUser.set(event.subject.userId, { ...loc, at: now });
  }

  private geoFeatures(event: RiskEvent, now: number): FeatureSnapshot["geo"] {
    const here = this.geo.resolve(event.subject.ip);
    const last = this.lastLocationByUser.get(event.subject.userId);
    const ipSimMismatch = event.attributes.geoMismatch === true;
    if (!here) return { ipSimMismatch, impossibleTravel: false, countryChanged: false };
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

  private addTo(map: Map<string, Set<string>>, key: string, value: string): void {
    const set = map.get(key) ?? new Set<string>();
    set.add(value);
    map.set(key, set);
  }

  /** Keep only the last 24h so the map doesn't grow without bound. */
  private prune(list: Attempt[], now: number): Attempt[] {
    const cutoff = now - 24 * 60 * 60_000;
    return list.filter((a) => a.at >= cutoff);
  }
}
