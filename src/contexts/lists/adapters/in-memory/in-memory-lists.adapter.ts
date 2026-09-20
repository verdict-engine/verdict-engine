import { Injectable } from "@nestjs/common";
import type { RiskEvent } from "@contexts/ingest/application/ingest.port";
import type {
  ListEntry,
  ListKind,
  ListMatch,
  ListsPort,
  ListSubject,
} from "../../application/lists.port";

/** In-memory lists — default adapter. A SQL/Redis adapter implements the same port. */
@Injectable()
export class InMemoryLists implements ListsPort {
  private readonly entries = new Map<string, ListEntry>();

  async add(entry: ListEntry): Promise<void> {
    this.entries.set(key(entry.kind, entry.subject, entry.value), entry);
  }

  async check(event: RiskEvent): Promise<ListMatch> {
    for (const kind of ["block", "allow", "watch"] as ListKind[]) {
      for (const [subject, value] of this.subjectsOf(event)) {
        const entry = this.entries.get(key(kind, subject, value));
        if (entry) return { decision: decisionFor(kind), reason: entry.reason ?? `${kind}:${subject}` };
      }
    }
    return { decision: "none" };
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
