import { Inject, Injectable } from "@nestjs/common";
import { CLOCK, type Clock } from "@shared/ports/clock.port";
import { STORE, type Store } from "@shared/ports/store.port";
import type { Verdict } from "../domain/verdict";
import { VERDICT_LOG_PORT, type VerdictLogPort } from "./verdict-log.port";

const DAY_MS = 24 * 60 * 60 * 1000;
const DEFAULT_LIMIT = 10_000;
const MAX_LIMIT = 100_000;

/** A fraud/legit label on a past event (chargebacks arrive weeks later). Stored by the feedback context. */
interface Label {
  readonly eventId: string;
  readonly outcome: "fraud" | "legit";
}

export interface ShadowReport {
  readonly window: { readonly sinceDays: number; readonly from: string };
  /** How many of the most recent decisions this report is computed over (the scan cap). */
  readonly scanned: number;
  readonly total: number;
  readonly byVerdict: Record<Verdict, number>;
  /** Fraction the shadow policy would have stopped (review + deny), the headline to compare at parity. */
  readonly wouldBlockRate: number;
  readonly challengeRate: number;
  /** Of the shadow decisions, how many now carry a fraud label (labels lag, so this grows over time). */
  readonly labeledFraud: number;
  /** Of the labeled-fraud, how many the shadow verdict would have stopped (review/deny) vs let through. */
  readonly caught: number;
  readonly missed: number;
  /** caught / labeledFraud — what share of confirmed fraud the shadow policy would have stopped. */
  readonly catchRate: number;
}

/**
 * Builds the side-by-side a team needs before trusting a switch: over a recent window, what the shadow
 * policy would have blocked, and — once chargeback labels catch up — what share of confirmed fraud it
 * would have caught vs missed. Reads only shadow decisions (never the enforced ones) and joins them to
 * the labels by event id. Scoped to the caller's org, like every other read.
 */
@Injectable()
export class ShadowReportService {
  constructor(
    @Inject(VERDICT_LOG_PORT) private readonly log: VerdictLogPort,
    @Inject(STORE) private readonly store: Store,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async report(sinceDays: number, limit = DEFAULT_LIMIT): Promise<ShadowReport> {
    const scan = Math.min(Math.max(Math.floor(limit) || DEFAULT_LIMIT, 1), MAX_LIMIT);
    const from = new Date(this.clock.now().getTime() - sinceDays * DAY_MS).toISOString();

    const shadow = (await this.log.recent(scan)).filter((d) => d.shadow === true && d.decidedAt >= from);
    const fraud = new Set(
      (await this.store.collection<Label>("labels").all()).filter((l) => l.outcome === "fraud").map((l) => l.eventId),
    );

    const byVerdict: Record<Verdict, number> = { allow: 0, challenge: 0, review: 0, deny: 0 };
    let caught = 0;
    let missed = 0;
    for (const d of shadow) {
      byVerdict[d.verdict]++;
      if (!fraud.has(d.eventId)) continue;
      // "Would have stopped it" = review (held for a human) or deny; challenge/allow let it proceed.
      if (d.verdict === "review" || d.verdict === "deny") caught++;
      else missed++;
    }

    const total = shadow.length;
    const labeledFraud = caught + missed;
    return {
      window: { sinceDays, from },
      scanned: scan,
      total,
      byVerdict,
      wouldBlockRate: ratio(byVerdict.review + byVerdict.deny, total),
      challengeRate: ratio(byVerdict.challenge, total),
      labeledFraud,
      caught,
      missed,
      catchRate: ratio(caught, labeledFraud),
    };
  }
}

function ratio(n: number, d: number): number {
  return d === 0 ? 0 : Math.round((n / d) * 1e4) / 1e4;
}
