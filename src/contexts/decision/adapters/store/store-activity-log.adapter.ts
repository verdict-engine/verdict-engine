import { Inject, Injectable } from "@nestjs/common";
import { STORE, type Store, type TxContext } from "@shared/ports/store.port";
import type { ActivityEntry, ActivityLogPort } from "../../application/activity-log.port";

const COLLECTION = "activity";

/** Append-only, durable via the Store. Mirrors StoreVerdictLog but keeps the request too. */
@Injectable()
export class StoreActivityLog implements ActivityLogPort {
  constructor(@Inject(STORE) private readonly store: Store) {}

  async append(entry: ActivityEntry, tx?: TxContext): Promise<void> {
    await (tx ?? this.store).collection<ActivityEntry>(COLLECTION).put(entry.id, entry);
  }

  async recent(limit: number): Promise<ActivityEntry[]> {
    return (await this.store.collection<ActivityEntry>(COLLECTION).all())
      .sort((a, b) => b.decidedAt.localeCompare(a.decidedAt))
      .slice(0, limit);
  }

  async eraseSubject(userId: string): Promise<number> {
    const col = this.store.collection<ActivityEntry>(COLLECTION);
    const all = await col.all();
    let removed = 0;
    for (const entry of all) {
      if (entry.request.subject.userId === userId) {
        await col.delete(entry.id);
        removed++;
      }
    }
    return removed;
  }
}
