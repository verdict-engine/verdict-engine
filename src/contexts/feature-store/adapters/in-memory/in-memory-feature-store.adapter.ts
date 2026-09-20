import { Inject, Injectable } from "@nestjs/common";
import { CLOCK, type Clock } from "@shared/ports/clock.port";
import type { RiskEvent } from "@contexts/ingest/application/ingest.port";
import type {
  FeatureSnapshot,
  FeatureStorePort,
} from "../../application/feature-store.port";

interface Attempt {
  readonly at: number;
  readonly amount: number;
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

  constructor(@Inject(CLOCK) private readonly clock: Clock) {}

  async snapshot(event: RiskEvent): Promise<FeatureSnapshot> {
    const now = this.clock.now().getTime();
    const attempts = this.attemptsByUser.get(event.subject.userId) ?? [];
    const within = (ms: number) => attempts.filter((a) => now - a.at <= ms);

    const deviceId = event.subject.deviceId;
    const usersOnDevice = deviceId ? (this.usersByDevice.get(deviceId)?.size ?? 0) : 0;
    const firstSeen = deviceId ? !this.seenDevices.has(deviceId) : false;

    return {
      velocity: {
        attemptsLast2m: within(2 * 60_000).length,
        attemptsLast24h: within(24 * 60 * 60_000).length,
        amountLast1h: within(60 * 60_000).reduce((s, a) => s + a.amount, 0),
      },
      device: { firstSeen, usersOnDevice },
      geo: { ipSimMismatch: event.attributes.geoMismatch === true },
    };
  }

  async record(event: RiskEvent): Promise<void> {
    const now = this.clock.now().getTime();
    const list = this.attemptsByUser.get(event.subject.userId) ?? [];
    list.push({ at: now, amount: event.money?.amount ?? 0 });
    this.attemptsByUser.set(event.subject.userId, this.prune(list, now));

    const deviceId = event.subject.deviceId;
    if (deviceId) {
      const users = this.usersByDevice.get(deviceId) ?? new Set<string>();
      users.add(event.subject.userId);
      this.usersByDevice.set(deviceId, users);
      this.seenDevices.add(deviceId);
    }
  }

  /** Keep only the last 24h so the map doesn't grow without bound. */
  private prune(list: Attempt[], now: number): Attempt[] {
    const cutoff = now - 24 * 60 * 60_000;
    return list.filter((a) => a.at >= cutoff);
  }
}
