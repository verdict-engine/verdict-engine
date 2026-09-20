import { Inject, Injectable, type OnModuleDestroy, type OnModuleInit } from "@nestjs/common";
import type { DomainEvent } from "@shared/domain/domain-event";
import { CLOCK, type Clock } from "@shared/ports/clock.port";
import { EVENT_BUS, type EventBus } from "@shared/ports/event-bus.port";
import { STORE, type Collection, type Store, type TxContext } from "@shared/ports/store.port";
import { causeMessage, logEvent } from "@shared/observability/log";
import { deadLetterAlert } from "@shared/domain/alerts";
import {
  outboxDeadLetteredTotal,
  outboxDeliveredTotal,
  outboxFailedTotal,
  outboxPending,
} from "@shared/observability/metrics";
import type { OutboxPort } from "./outbox.port";
import { OUTBOX_COLLECTION, OUTBOX_DLQ_COLLECTION, OUTBOX_LOCK_COLLECTION, type OutboxRow } from "./outbox.model";

const POLL_MS = 1000;
const BATCH = 50;
const MAX_ATTEMPTS = 8;
/** How long a replica holds a row before another may reclaim it (covers a crashed holder). */
const LEASE_MS = 30_000;
/** Exponential backoff, capped — 1s, 2s, 4s … up to 10 min between tries. */
const BACKOFF_BASE_MS = 1000;
const BACKOFF_CAP_MS = 10 * 60 * 1000;

/**
 * The durable outbox and its relay in one unit. `enqueue` writes the event row inside the
 * caller's transaction, so it commits atomically with the verdict. `flush` kicks a non-blocking
 * drain right after commit for low delivery latency; a periodic poll is the backstop that retries
 * anything a flush missed or that failed. Delivery is at-least-once (consumers dedupe on
 * `event.id`): delivered rows are deleted, failures retry with exponential backoff, and a row that
 * exhausts its attempts moves to the dead-letter collection for an operator to inspect.
 */
@Injectable()
export class OutboxRelay implements OutboxPort, OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private ticking = false;

  constructor(
    @Inject(STORE) private readonly store: Store,
    @Inject(EVENT_BUS) private readonly bus: EventBus,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  onModuleInit(): void {
    // Skip the background timer under unit tests (they drive drainOnce() directly); the app and
    // e2e tests still get prompt delivery via flush(), and this poll is the retry backstop.
    if (process.env.VITEST === "true" || process.env.NODE_ENV === "test") return;
    this.timer = setInterval(() => void this.tick(), POLL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  async enqueue(event: DomainEvent, tx?: TxContext): Promise<void> {
    const now = this.clock.isoNow();
    const row: OutboxRow = { event, status: "pending", attempts: 0, nextAttemptAt: now, createdAt: now };
    await (tx ?? this.store).collection<OutboxRow>(OUTBOX_COLLECTION).put(event.id, row);
  }

  /** Fire-and-forget nudge, called right after the commit — delivery stays off the request path. */
  flush(): void {
    queueMicrotask(() => void this.tick());
  }

  private async tick(): Promise<void> {
    if (this.ticking) return;
    this.ticking = true;
    try {
      await this.drainOnce();
    } catch (cause) {
      logEvent("error", "outbox.relay.tick_failed", { cause: causeMessage(cause) });
    } finally {
      this.ticking = false;
    }
  }

  /** One pass over due rows. Returns how many were delivered — used by tests. */
  async drainOnce(): Promise<number> {
    const col = this.store.collection<OutboxRow>(OUTBOX_COLLECTION);
    const now = this.clock.isoNow();
    const all = await col.all();
    outboxPending.set(all.filter((r) => r.status === "pending").length);
    const due = all
      .filter((r) => r.status === "pending" && r.nextAttemptAt <= now)
      .sort((a, b) => a.nextAttemptAt.localeCompare(b.nextAttemptAt))
      .slice(0, BATCH);

    const locks = this.store.collection<{ until: number }>(OUTBOX_LOCK_COLLECTION);
    let delivered = 0;
    for (const row of due) {
      if (!(await this.acquire(locks, row.event.id))) continue; // another replica owns this row
      try {
        await this.bus.publish(row.event);
        await col.delete(row.event.id);
        outboxDeliveredTotal.inc();
        delivered++;
      } catch (cause) {
        await this.onFailure(col, row, causeMessage(cause));
      } finally {
        await locks.delete(row.event.id).catch(() => undefined);
      }
    }
    return delivered;
  }

  /**
   * Lease a row for this replica with an atomic insert-if-absent, so two replays never process the
   * same outbox row at once (the flagged multi-replica hazard). An expired lease (a crashed holder)
   * is reclaimed on a later tick. Store-agnostic — needs only the atomic putIfAbsent primitive.
   */
  private async acquire(locks: Collection<{ until: number }>, id: string): Promise<boolean> {
    const now = Date.now();
    if (await locks.putIfAbsent(id, { until: now + LEASE_MS })) return true;
    const held = await locks.get(id);
    if (held && held.until < now) await locks.delete(id); // stale — free it for the next tick
    return false;
  }

  private async onFailure(col: Collection<OutboxRow>, row: OutboxRow, error: string): Promise<void> {
    outboxFailedTotal.inc();
    const attempts = row.attempts + 1;
    if (attempts >= MAX_ATTEMPTS) {
      const dead: OutboxRow = { ...row, status: "dead", attempts, lastError: error };
      await this.store.collection<OutboxRow>(OUTBOX_DLQ_COLLECTION).put(row.event.id, dead);
      await col.delete(row.event.id);
      outboxDeadLetteredTotal.inc();
      logEvent("error", "outbox.relay.dead_lettered", { eventId: row.event.id, name: row.event.name, attempts, error });
      // Best-effort operator alert (its own bus fan-out, never blocks or throws here).
      await this.bus
        .publish(deadLetterAlert({ source: "outbox", ref: row.event.id, name: row.event.name, attempts, error }, this.clock.isoNow(), row.event.correlationId))
        .catch(() => undefined);
      return;
    }
    const delay = Math.min(BACKOFF_CAP_MS, BACKOFF_BASE_MS * 2 ** (attempts - 1));
    const nextAttemptAt = new Date(new Date(this.clock.isoNow()).getTime() + delay).toISOString();
    await col.put(row.event.id, { ...row, attempts, nextAttemptAt, lastError: error });
    logEvent("warn", "outbox.relay.retry_scheduled", { eventId: row.event.id, attempts, nextAttemptAt });
  }
}
