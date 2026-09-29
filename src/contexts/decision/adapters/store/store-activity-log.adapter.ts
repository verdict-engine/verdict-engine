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
    return this.store.collection<ActivityEntry>(COLLECTION).query({ orderByDesc: "decidedAt", limit });
  }

  async eraseSubject(userId: string): Promise<number> {
    return this.store.collection<ActivityEntry>(COLLECTION).deleteWhere("request.subject.userId", userId);
  }
}
