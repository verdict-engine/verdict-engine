import { Inject, Injectable } from "@nestjs/common";
import { LIMITS } from "../../config/limits";
import { STORE, type Collection, type Store } from "../ports/store.port";

export const RATE_LIMIT_SETTINGS = Symbol("RateLimitSettings");

interface Overrides {
  decisionsPerMin?: number;
  loginPerMin?: number;
}

export interface EffectiveLimit {
  limit: number;
  windowMs: number;
}

export interface RateLimitSnapshot {
  windowMs: number;
  decisionsPerMin: number;
  loginPerMin: number;
  /** Which values are dashboard overrides vs. the env/default baseline. */
  overridden: { decisionsPerMin: boolean; loginPerMin: boolean };
}

const DOC = "rate-limits";
const CACHE_TTL_MS = 10_000;
const MAX = 1_000_000;

/**
 * The effective per-caller rate limits: env/`LIMITS` defaults, overridable at runtime from the
 * dashboard and persisted in the store. The guard resolves the limit per request (cached ~10s), so
 * an operator can retune without a redeploy; other replicas pick up a change within the TTL.
 */
@Injectable()
export class RateLimitSettings {
  private readonly config: Collection<Overrides>;
  private cache: Overrides = {};
  private expiresAt = 0;

  constructor(@Inject(STORE) store: Store) {
    this.config = store.collection<Overrides>("config");
  }

  private async overrides(): Promise<Overrides> {
    if (Date.now() < this.expiresAt) return this.cache;
    this.cache = (await this.config.get(DOC)) ?? {};
    this.expiresAt = Date.now() + CACHE_TTL_MS;
    return this.cache;
  }

  /** The limit + window for a named budget ("decisions" or "login"). */
  async resolve(name: string): Promise<EffectiveLimit> {
    const o = await this.overrides();
    const limit = name === "login" ? (o.loginPerMin ?? LIMITS.loginPerMin) : (o.decisionsPerMin ?? LIMITS.decisionsPerMin);
    return { limit, windowMs: LIMITS.windowMs };
  }

  async snapshot(): Promise<RateLimitSnapshot> {
    const o = await this.overrides();
    return {
      windowMs: LIMITS.windowMs,
      decisionsPerMin: o.decisionsPerMin ?? LIMITS.decisionsPerMin,
      loginPerMin: o.loginPerMin ?? LIMITS.loginPerMin,
      overridden: { decisionsPerMin: o.decisionsPerMin !== undefined, loginPerMin: o.loginPerMin !== undefined },
    };
  }

  /** Set or clear overrides. A field set to `null` reverts to the env/default. Returns the new snapshot. */
  async update(patch: { decisionsPerMin?: number | null; loginPerMin?: number | null }): Promise<RateLimitSnapshot> {
    const next: Overrides = { ...((await this.config.get(DOC)) ?? {}) };
    for (const key of ["decisionsPerMin", "loginPerMin"] as const) {
      const v = patch[key];
      if (v === null) delete next[key];
      else if (v !== undefined) {
        if (typeof v !== "number" || !Number.isInteger(v) || v < 1 || v > MAX) {
          throw new RateLimitConfigError(`${key} must be a whole number between 1 and ${MAX}`);
        }
        next[key] = v;
      }
    }
    await this.config.put(DOC, next);
    this.cache = next;
    this.expiresAt = Date.now() + CACHE_TTL_MS;
    return this.snapshot();
  }
}

export class RateLimitConfigError extends Error {}
