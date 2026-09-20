import { Inject, Injectable } from "@nestjs/common";
import { RETENTION } from "../../../config/retention";
import { STORE, type Collection, type Store } from "@shared/ports/store.port";

export const RETENTION_SETTINGS = Symbol("RetentionSettings");

type Key = keyof typeof RETENTION.days;
type Overrides = Partial<Record<Key, number>>;

export interface RetentionSnapshot {
  sweepMinutes: number;
  /** Effective retention window per collection, in days. 0 means keep forever. */
  days: Record<Key, number>;
  /** Which windows are dashboard overrides vs. the env/default baseline. */
  overridden: Record<Key, boolean>;
}

const DOC = "retention";
const CACHE_TTL_MS = 10_000;
const MAX_DAYS = 36_500; // 100 years — an effective "keep forever" ceiling on any single value

const KEYS = Object.keys(RETENTION.days) as Key[];

/**
 * Runtime, operator-editable retention windows, persisted in the store and cached ~10s. The prune
 * job reads these each sweep, so an operator can lengthen or shorten a window (or set 0 to keep a
 * collection forever) from the dashboard without a redeploy. Defaults come from env (`config/retention`).
 */
@Injectable()
export class RetentionSettings {
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

  /** Effective retention window for a collection, in days (0 = keep forever). */
  async daysFor(key: Key): Promise<number> {
    return (await this.overrides())[key] ?? RETENTION.days[key];
  }

  async snapshot(): Promise<RetentionSnapshot> {
    const o = await this.overrides();
    const days = {} as Record<Key, number>;
    const overridden = {} as Record<Key, boolean>;
    for (const k of KEYS) {
      days[k] = o[k] ?? RETENTION.days[k];
      overridden[k] = o[k] !== undefined;
    }
    return { sweepMinutes: RETENTION.sweepMinutes, days, overridden };
  }

  /** Set or clear per-collection windows. A field set to null reverts to the env default. */
  async update(patch: Partial<Record<Key, number | null>>): Promise<RetentionSnapshot> {
    const next: Overrides = { ...((await this.config.get(DOC)) ?? {}) };
    for (const key of KEYS) {
      const v = patch[key];
      if (v === null) delete next[key];
      else if (v !== undefined) {
        if (typeof v !== "number" || !Number.isInteger(v) || v < 0 || v > MAX_DAYS) {
          throw new RetentionConfigError(`${key} must be a whole number of days between 0 and ${MAX_DAYS}`);
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

export class RetentionConfigError extends Error {}
