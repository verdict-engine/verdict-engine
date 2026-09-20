const days = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

const minutes = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/**
 * How long each append-only collection is kept before the prune job ages it out, in days.
 * `0` means keep forever (that collection is skipped). Defaults are deliberately generous for the
 * audit trail (verdicts) and short for operational scratch (idempotency keys only need to outlive a
 * client's retries). Overridable per deployment via env, and at runtime from the dashboard.
 */
export const RETENTION = {
  sweepMinutes: minutes(process.env.RETENTION_SWEEP_MINUTES, 60),
  days: {
    verdicts: days(process.env.RETENTION_VERDICTS_DAYS, 365),
    activity: days(process.env.RETENTION_ACTIVITY_DAYS, 90),
    replay: days(process.env.RETENTION_REPLAY_DAYS, 90),
    idempotency: days(process.env.RETENTION_IDEMPOTENCY_DAYS, 7),
    deadLetter: days(process.env.RETENTION_DEAD_LETTER_DAYS, 30),
  },
};

/** The prunable collections and the timestamp field each is aged out by. `key` maps to RETENTION.days. */
export interface PruneTarget {
  readonly key: keyof typeof RETENTION.days;
  readonly collection: string;
  readonly tsField: string;
}

export const PRUNE_TARGETS: PruneTarget[] = [
  { key: "verdicts", collection: "verdicts", tsField: "decidedAt" },
  { key: "activity", collection: "activity", tsField: "decidedAt" },
  { key: "replay", collection: "replay-samples", tsField: "decidedAt" },
  { key: "idempotency", collection: "idempotency", tsField: "claimedAt" },
  { key: "deadLetter", collection: "outbox_dead", tsField: "createdAt" },
];
