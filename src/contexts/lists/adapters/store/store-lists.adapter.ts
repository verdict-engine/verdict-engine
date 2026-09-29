import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { STORE, type Store } from "@shared/ports/store.port";
import { DEFAULT_ORG, currentOrg } from "@shared/adapters/tenant-context";
import type { RiskEvent } from "@contexts/ingest/application/ingest.port";
import type {
  ListEntry,
  ListKind,
  ListMatch,
  ListsPort,
  ListSubject,
} from "../../application/lists.port";

const COLLECTION = "lists";

/**
 * Store-backed allow/block/watch lists. A write-through in-memory index keeps the pre-scoring check
 * on the decision path O(1), while every entry is persisted to the `STORE` so list changes survive a
 * restart. The index is hydrated from the store on boot.
 *
 * Multi-tenant: the index is keyed by org, and the check consults only the request's org — a block on
 * a user in one tenant never affects another. In a multi-replica deployment an entry added on one
 * replica reaches the others on their next restart.
 */
@Injectable()
export class StoreLists implements ListsPort, OnModuleInit {
  private byOrg = new Map<string, Map<string, ListEntry>>();

  constructor(@Inject(STORE) private readonly store: Store) {}

  async onModuleInit(): Promise<void> {
    const index = new Map<string, Map<string, ListEntry>>();
    for (const entry of await this.store.collection<ListEntry>(COLLECTION).all()) {
      this.bucket(index, entry.orgId ?? DEFAULT_ORG).set(key(entry.kind, entry.subject, entry.value), entry);
    }
    this.byOrg = index;
  }

  async add(entry: ListEntry): Promise<void> {
    const org = currentOrg() ?? DEFAULT_ORG;
    const stored: ListEntry = { ...entry, orgId: org };
    const id = key(stored.kind, stored.subject, stored.value);
    this.bucket(this.byOrg, org).set(id, stored);
    await this.store.collection<ListEntry>(COLLECTION).put(id, stored);
  }

  async check(event: RiskEvent): Promise<ListMatch> {
    const entries = this.byOrg.get(currentOrg() ?? DEFAULT_ORG);
    if (!entries) return { decision: "none" };
    for (const kind of ["block", "allow", "watch"] as ListKind[]) {
      for (const [subject, value] of this.subjectsOf(event)) {
        const entry = entries.get(key(kind, subject, value));
        if (entry) return { decision: decisionFor(kind), reason: entry.reason ?? `${kind}:${subject}` };
      }
    }
    return { decision: "none" };
  }

  private bucket(index: Map<string, Map<string, ListEntry>>, org: string): Map<string, ListEntry> {
    let m = index.get(org);
    if (!m) {
      m = new Map();
      index.set(org, m);
    }
    return m;
  }

  private subjectsOf(event: RiskEvent): Array<[ListSubject, string]> {
    const out: Array<[ListSubject, string]> = [["user", event.subject.userId]];
    if (event.subject.deviceId) out.push(["device", event.subject.deviceId]);
    if (event.subject.ip) out.push(["ip", event.subject.ip]);
    if (event.instrument?.bin) out.push(["bin", event.instrument.bin]);
    return out;
  }
}

function key(kind: ListKind, subject: ListSubject, value: string): string {
  return `${kind}:${subject}:${value}`;
}
function decisionFor(kind: ListKind): ListMatch["decision"] {
  return kind === "block" ? "deny" : kind === "allow" ? "allow" : "watch";
}
