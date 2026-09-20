import { Inject, Injectable } from "@nestjs/common";
import { CLOCK, type Clock } from "../ports/clock.port";
import { ID_GENERATOR, type IdGenerator } from "../ports/id-generator.port";
import { STORE, type Collection, type Store } from "../ports/store.port";
import type { AuditEntry, AuditView } from "../domain/audit";

export const AUDIT_LOG = Symbol("AuditLog");

const COLLECTION = "audit-log";

export interface AuditPage {
  entries: AuditView[];
  total: number;
}

/**
 * Append-only record of administrative changes, durable via the Store. Written by the audit
 * interceptor on every operator mutation and read by the admin audit view — so a config change is
 * always attributable to a person and a time, without trusting the app logs to still be around.
 */
@Injectable()
export class AuditLog {
  private readonly entries: Collection<AuditEntry>;

  constructor(
    @Inject(STORE) store: Store,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
  ) {
    this.entries = store.collection<AuditEntry>(COLLECTION);
  }

  async record(entry: Omit<AuditEntry, "id" | "at">): Promise<void> {
    const id = this.ids.next("aud");
    await this.entries.put(id, { ...entry, id, at: this.clock.isoNow() });
  }

  /** Newest-first page of the audit trail, plus the total count for the pager. */
  async list(limit: number, offset = 0): Promise<AuditPage> {
    const all = (await this.entries.all()).sort((a, b) => b.at.localeCompare(a.at));
    return { entries: all.slice(offset, offset + limit), total: all.length };
  }
}
