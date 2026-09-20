import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import { PRUNE_TARGETS, RETENTION } from "../../../config/retention";
import { CLOCK, type Clock } from "@shared/ports/clock.port";
import { STORE, type Store } from "@shared/ports/store.port";
import { causeMessage, logEvent } from "@shared/observability/log";
import { retentionLastRunSeconds, retentionPrunedTotal } from "@shared/observability/metrics";
import { RETENTION_SETTINGS, type RetentionSettings } from "./retention-settings";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PruneReport {
  ranAt: string;
  /** Records deleted this sweep, per collection key. */
  pruned: Record<string, number>;
}

/**
 * Bounds the append-only collections (verdicts, activity, replay samples, idempotency keys,
 * dead-lettered outbox rows) so they don't grow without limit. On a timer it deletes rows older than
 * each collection's configured retention window; a window of 0 keeps that collection forever. The
 * delete is store-agnostic (Collection.prune) — an indexed range delete on Postgres, an in-memory
 * scan in dev — so it never loads a whole collection to age it out.
 */
@Injectable()
export class PruneService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;

  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(RETENTION_SETTINGS) private readonly settings: RetentionSettings,
  ) {}

  onModuleInit(): void {
    // Tests drive sweep() directly; the app runs it on a timer. unref so it never holds the process open.
    if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.tick(), RETENTION.sweepMinutes * 60 * 1000);
    this.timer.unref?.();
    // A sweep shortly after boot, so a long-idle instance doesn't wait a whole interval to catch up.
    setTimeout(() => void this.tick(), 30_000).unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  private async tick(): Promise<void> {
    if (this.running) return; // never overlap sweeps
    this.running = true;
    try {
      await this.sweep();
    } catch (cause) {
      logEvent("error", "retention.sweep_failed", { cause: causeMessage(cause) });
    } finally {
      this.running = false;
    }
  }

  /** One retention pass over every target. Returns what it deleted — used by the manual run + tests. */
  async sweep(): Promise<PruneReport> {
    const now = this.clock.now().getTime();
    const pruned: Record<string, number> = {};
    for (const target of PRUNE_TARGETS) {
      const days = await this.settings.daysFor(target.key);
      if (days <= 0) continue; // keep-forever
      const cutoff = new Date(now - days * DAY_MS).toISOString();
      const removed = await this.store.collection(target.collection).prune(target.tsField, cutoff);
      pruned[target.key] = removed;
      if (removed > 0) {
        retentionPrunedTotal.inc({ collection: target.key }, removed);
        logEvent("info", "retention.pruned", { collection: target.collection, removed, cutoff });
      }
    }
    retentionLastRunSeconds.set(Math.floor(Date.now() / 1000));
    return { ranAt: this.clock.isoNow(), pruned };
  }
}
