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
    return this.store
      .collection<ReplaySample>(COLLECTION)
      .query({ where: { eventType }, orderByDesc: "decidedAt", limit });
  }

  async eraseSubject(userId: string): Promise<number> {
    return this.store.collection<ReplaySample>(COLLECTION).deleteWhere("event.subject.userId", userId);
  }
}
