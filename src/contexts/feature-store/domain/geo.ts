import { createHash } from "node:crypto";

export interface GeoLocation {
  readonly country: string;
  readonly lat: number;
  readonly lon: number;
}

/**
 * Resolves a client IP to a coarse location. The port is deliberately tiny so a production adapter
 * can wrap an embedded GeoIP database (e.g. MaxMind GeoLite2) behind the same interface — the lookup
 * must stay a local, sub-millisecond call so it never slows the decision path with a network hop.
 */
export interface GeoResolver {
  resolve(ip: string | undefined): GeoLocation | null;
}

export const GEO_RESOLVER = Symbol("GeoResolver");

/** A representative spread of city coordinates, enough to exercise distance/country signals. */
const CITIES: GeoLocation[] = [
  { country: "ET", lat: 9.03, lon: 38.74 }, // Addis Ababa
  { country: "KE", lat: -1.29, lon: 36.82 }, // Nairobi
  { country: "NG", lat: 6.52, lon: 3.38 }, // Lagos
  { country: "GB", lat: 51.51, lon: -0.13 }, // London
  { country: "US", lat: 40.71, lon: -74.01 }, // New York
  { country: "AE", lat: 25.2, lon: 55.27 }, // Dubai
  { country: "IN", lat: 19.08, lon: 72.88 }, // Mumbai
  { country: "CN", lat: 31.23, lon: 121.47 }, // Shanghai
  { country: "BR", lat: -23.55, lon: -46.63 }, // São Paulo
  { country: "RU", lat: 55.75, lon: 37.62 }, // Moscow
];

/**
 * A deterministic offline resolver: hashes the IP to one of the cities above. It is not a real
 * GeoIP database — it exists so dev, tests and the synthetic training set get stable, varied
 * locations without a network dependency. Swap in a real GeoIP adapter in production via GEO_RESOLVER.
 */
export class SyntheticGeoResolver implements GeoResolver {
  resolve(ip: string | undefined): GeoLocation | null {
    if (!ip) return null;
    const h = createHash("sha256").update(ip).digest();
    return CITIES[h[0] % CITIES.length];
  }
}

const EARTH_RADIUS_KM = 6371;
const toRad = (deg: number): number => (deg * Math.PI) / 180;

/** Great-circle distance between two points in kilometres (haversine). */
export function haversineKm(a: GeoLocation, b: GeoLocation): number {
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const s = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLon / 2) ** 2;
  return 2 * EARTH_RADIUS_KM * Math.asin(Math.min(1, Math.sqrt(s)));
}

/** Faster than a commercial jet ⇒ the two events can't both be the same person travelling. */
export const IMPOSSIBLE_TRAVEL_KMH = 900;

/** True when moving `distanceKm` in `elapsedMs` implies a speed above the impossible-travel threshold. */
export function isImpossibleTravel(distanceKm: number, elapsedMs: number): boolean {
  if (elapsedMs <= 0) return distanceKm > 100; // same instant, different city ⇒ impossible
  const hours = elapsedMs / 3_600_000;
  return distanceKm / hours > IMPOSSIBLE_TRAVEL_KMH;
}
