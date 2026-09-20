import { Inject, Injectable } from "@nestjs/common";
import { STORE, type Collection, type Store } from "../ports/store.port";

export const ALERT_SETTINGS = Symbol("AlertSettings");

interface AlertConfig {
  anomalyZScore?: number;
}

export interface AlertSnapshot {
  /** Amount z-score at or above which a decision emits alert.anomaly.v1. */
  anomalyZScore: number;
  overridden: { anomalyZScore: boolean };
}

const DOC = "alerts";
const CACHE_TTL_MS = 10_000;
const DEFAULT_Z = 3; // 3σ from the user's own baseline
const MAX_Z = 100;

/**
 * Runtime, operator-editable alerting thresholds (the anomaly z-score today), persisted in the
 * store and cached ~10s. Read on the decision path to decide whether to emit an anomaly alert, so
 * an operator can tune sensitivity from the dashboard without a redeploy.
 */
@Injectable()
export class AlertSettings {
  private readonly config: Collection<AlertConfig>;
  private cache: AlertConfig = {};
  private expiresAt = 0;

  constructor(@Inject(STORE) store: Store) {
    this.config = store.collection<AlertConfig>("config");
  }

  private async current(): Promise<AlertConfig> {
    if (Date.now() < this.expiresAt) return this.cache;
    this.cache = (await this.config.get(DOC)) ?? {};
    this.expiresAt = Date.now() + CACHE_TTL_MS;
    return this.cache;
  }

  async anomalyThreshold(): Promise<number> {
    return (await this.current()).anomalyZScore ?? DEFAULT_Z;
  }

  async snapshot(): Promise<AlertSnapshot> {
    const c = await this.current();
    return { anomalyZScore: c.anomalyZScore ?? DEFAULT_Z, overridden: { anomalyZScore: c.anomalyZScore !== undefined } };
  }

  async update(patch: { anomalyZScore?: number | null }): Promise<AlertSnapshot> {
    const next: AlertConfig = { ...((await this.config.get(DOC)) ?? {}) };
    if (patch.anomalyZScore === null) delete next.anomalyZScore;
    else if (patch.anomalyZScore !== undefined) {
      const v = patch.anomalyZScore;
      if (typeof v !== "number" || !Number.isFinite(v) || v <= 0 || v > MAX_Z) {
        throw new AlertConfigError(`anomalyZScore must be a number between 0 and ${MAX_Z}`);
      }
      next.anomalyZScore = v;
    }
    await this.config.put(DOC, next);
    this.cache = next;
    this.expiresAt = Date.now() + CACHE_TTL_MS;
    return this.snapshot();
  }
}

export class AlertConfigError extends Error {}
