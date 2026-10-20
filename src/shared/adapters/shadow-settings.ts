import { Inject, Injectable } from "@nestjs/common";
import { STORE, type Collection, type Store } from "../ports/store.port";

export const SHADOW_SETTINGS = Symbol("ShadowSettings");

interface ShadowConfig {
  forceShadow?: boolean;
}

export interface ShadowSnapshot {
  /** When true, every decision is scored in shadow mode regardless of the per-request header. */
  forceShadow: boolean;
  overridden: { forceShadow: boolean };
}

const DOC = "shadow";
const CACHE_TTL_MS = 10_000;

/**
 * Runtime, operator-editable "force shadow" switch, persisted in the store and cached ~10s. Read on
 * the decision path: when on, every decision runs non-enforcing (logged for comparison, no fan-out,
 * no case) regardless of the `X-Verdict-Mode` header — a deployment-wide evaluation period an
 * operator can turn on from the dashboard and off again, with no redeploy.
 */
@Injectable()
export class ShadowSettings {
  private readonly config: Collection<ShadowConfig>;
  private cache: ShadowConfig = {};
  private expiresAt = 0;

  constructor(@Inject(STORE) store: Store) {
    this.config = store.collection<ShadowConfig>("config");
  }

  private async current(): Promise<ShadowConfig> {
    if (Date.now() < this.expiresAt) return this.cache;
    this.cache = (await this.config.get(DOC)) ?? {};
    this.expiresAt = Date.now() + CACHE_TTL_MS;
    return this.cache;
  }

  /** Whether every decision should be forced into shadow mode right now. */
  async forced(): Promise<boolean> {
    return (await this.current()).forceShadow === true;
  }

  async snapshot(): Promise<ShadowSnapshot> {
    const c = await this.current();
    return { forceShadow: c.forceShadow === true, overridden: { forceShadow: c.forceShadow !== undefined } };
  }

  async update(patch: { forceShadow?: boolean | null }): Promise<ShadowSnapshot> {
    const next: ShadowConfig = { ...((await this.config.get(DOC)) ?? {}) };
    if (patch.forceShadow === null) delete next.forceShadow;
    else if (patch.forceShadow !== undefined) {
      if (typeof patch.forceShadow !== "boolean") throw new ShadowConfigError("forceShadow must be a boolean");
      next.forceShadow = patch.forceShadow;
    }
    await this.config.put(DOC, next);
    this.cache = next;
    this.expiresAt = Date.now() + CACHE_TTL_MS;
    return this.snapshot();
  }
}

export class ShadowConfigError extends Error {}
