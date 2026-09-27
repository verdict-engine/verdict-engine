import { beforeEach, describe, expect, it } from "vitest";
import type { Clock } from "@shared/ports/clock.port";
import type { DeviceId, EventId, UserId } from "@shared/domain/ids";
import type { RiskEvent } from "@contexts/ingest/application/ingest.port";
import type { GeoLocation, GeoResolver } from "../../domain/geo";
import { InMemoryFeatureStore } from "./in-memory-feature-store.adapter";

const ADDIS: GeoLocation = { country: "ET", lat: 9.03, lon: 38.74 };
const LONDON: GeoLocation = { country: "GB", lat: 51.51, lon: -0.13 };

/** Resolver that maps an IP straight to a location we control in the test. */
class StubGeo implements GeoResolver {
  constructor(private readonly map: Record<string, GeoLocation>) {}
  resolve(ip: string | undefined): GeoLocation | null {
    if (!ip) return null;
    return this.map[ip] ?? null;
  }
}

interface Over {
  id?: string;
  userId?: string;
  deviceId?: string;
  fingerprint?: string;
  ip?: string;
}

const event = (over: Over): RiskEvent => ({
  id: (over.id ?? "evt") as EventId,
  type: "card.authorize",
  occurredAt: "2026-01-01T00:00:00.000Z",
  subject: {
    userId: (over.userId ?? "u1") as UserId,
    deviceId: over.deviceId as DeviceId | undefined,
    fingerprint: over.fingerprint,
    ip: over.ip,
  },
  attributes: {},
});

describe("InMemoryFeatureStore — geo & fingerprint", () => {
  let now: number;
  let clock: Clock;
  let store: InMemoryFeatureStore;

  beforeEach(() => {
    now = new Date("2026-01-01T00:00:00.000Z").getTime();
    clock = { now: () => new Date(now), isoNow: () => new Date(now).toISOString() };
    store = new InMemoryFeatureStore(clock, new StubGeo({ addis: ADDIS, london: LONDON }));
  });

  it("flags impossible travel and a country change between two far, close-in-time events", async () => {
    await store.record(event({ userId: "u1", ip: "addis" })); // seen in Addis
    now += 60_000; // one minute later…
    const snap = await store.snapshot(event({ userId: "u1", ip: "london" })); // …in London

    expect(snap.geo.country).toBe("GB");
    expect(snap.geo.countryChanged).toBe(true);
    expect(snap.geo.distanceKm).toBeGreaterThan(5000);
    expect(snap.geo.impossibleTravel).toBe(true);
  });

  it("does not flag impossible travel when enough time has passed", async () => {
    await store.record(event({ userId: "u2", ip: "addis" }));
    now += 24 * 60 * 60_000; // a day later
    const snap = await store.snapshot(event({ userId: "u2", ip: "london" }));

    expect(snap.geo.countryChanged).toBe(true);
    expect(snap.geo.impossibleTravel).toBe(false);
  });

  it("counts users sharing a fingerprint and flags a first sighting", async () => {
    let snap = await store.snapshot(event({ userId: "u1", fingerprint: "fp_x", deviceId: "d1" }));
    expect(snap.device.fingerprintFirstSeen).toBe(true);
    expect(snap.device.usersOnFingerprint).toBe(0);

    await store.record(event({ userId: "u1", fingerprint: "fp_x", deviceId: "d1" }));
    snap = await store.snapshot(event({ userId: "u2", fingerprint: "fp_x", deviceId: "d1" }));
    expect(snap.device.fingerprintFirstSeen).toBe(false);
    expect(snap.device.usersOnFingerprint).toBe(1); // u1 already on it
  });

  it("flags a fingerprint seen with a different device (cloning/spoofing)", async () => {
    await store.record(event({ userId: "u1", fingerprint: "fp_x", deviceId: "d1" }));
    const snap = await store.snapshot(event({ userId: "u1", fingerprint: "fp_x", deviceId: "d2" }));
    expect(snap.device.fingerprintDeviceMismatch).toBe(true);
  });
});
