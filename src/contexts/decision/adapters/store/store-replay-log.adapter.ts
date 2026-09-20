import { Inject, Injectable } from "@nestjs/common";
import { STORE, type Store, type TxContext } from "@shared/ports/store.port";
import type { ReplayLogPort, ReplaySample } from "../../application/replay-log.port";

const COLLECTION = "replay-samples";

/** Durable via the Store, keyed by eventId (one sample per decided event). */
@Injectable()
export class StoreReplayLog implements ReplayLogPort {
  constructor(@Inject(STORE) private readonly store: Store) {}

  async record(sample: ReplaySample, tx?: TxContext): Promise<void> {
    await (tx ?? this.store).collection<ReplaySample>(COLLECTION).put(sample.eventId, sample);
  }

  async samplesFor(eventType: string, limit: number): Promise<ReplaySample[]> {
    return (await this.store.collection<ReplaySample>(COLLECTION).all())
      .filter((s) => s.eventType === eventType)
      .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))
      .slice(0, limit);
  }

  async eraseSubject(userId: string): Promise<number> {
    const col = this.store.collection<ReplaySample>(COLLECTION);
    const matches = (await col.all()).filter((s) => s.event.subject.userId === userId);
    for (const sample of matches) await col.delete(sample.eventId);
    return matches.length;
  }
}
