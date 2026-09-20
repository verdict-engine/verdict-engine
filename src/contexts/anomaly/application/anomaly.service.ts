import { Inject, Injectable } from "@nestjs/common";
import { STORE, type Collection, type Store } from "@shared/ports/store.port";
import type { RiskEvent } from "@contexts/ingest/application/ingest.port";
import { emptyStats, observe, zScore, type Stats } from "../domain/stats";
import type { AnomalyFeatures, AnomalyPort } from "./anomaly.port";

const round2 = (n: number): number => Math.round(n * 100) / 100;

/**
 * Learns each user's spending baseline and flags an amount that deviates from it — "this
 * doesn't look like this account", which fixed thresholds can't express. Keyed per user
 * because what's normal for one is anomalous for another.
 */
@Injectable()
export class AnomalyService implements AnomalyPort {
  private readonly amountByUser: Collection<Stats>;

  constructor(@Inject(STORE) store: Store) {
    this.amountByUser = store.collection<Stats>("anomaly-user-amount");
  }

  async featuresFor(event: RiskEvent): Promise<AnomalyFeatures> {
    if (!event.money) return { amountZScore: 0, amountMean: 0, samples: 0 };
    const stats = (await this.amountByUser.get(event.subject.userId)) ?? emptyStats();
    return {
      amountZScore: round2(zScore(stats, event.money.amount)),
      amountMean: round2(stats.mean),
      samples: stats.count,
    };
  }

  async observe(event: RiskEvent): Promise<void> {
    if (!event.money) return;
    const stats = (await this.amountByUser.get(event.subject.userId)) ?? emptyStats();
    await this.amountByUser.put(event.subject.userId, observe(stats, event.money.amount));
  }

  async erase(userId: string): Promise<void> {
    await this.amountByUser.delete(userId);
  }
}
