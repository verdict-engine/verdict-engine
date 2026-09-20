import type { DomainEvent } from "@shared/domain/domain-event";

interface VerdictReached {
  verdict: string;
  score: number;
  eventType: string;
  eventId: string;
  reasons: ReadonlyArray<{ tag: string; points: number }>;
}
interface CaseResolved {
  caseId: string;
  outcome: string;
  analyst: string;
}
interface LabelRecorded {
  eventId: string;
  outcome: string;
  source: string;
}
interface DeadLetter {
  source: string;
  ref: string;
  name: string;
  attempts: number;
}
interface Anomaly {
  userId: string;
  eventId: string;
  eventType: string;
  amountZScore: number;
  amount?: number;
  currency?: string;
  verdict: string;
}

const ICON: Record<string, string> = { deny: "🚫", review: "🔎", challenge: "⚠️", allow: "✅" };

/** A one-line human summary of an engine event, for a Slack/webhook alert. No PII beyond ids. */
export function formatMessage(event: DomainEvent): string {
  const p = event.payload as Record<string, unknown>;
  switch (event.name) {
    case "verdict.reached.v1": {
      const v = p as unknown as VerdictReached;
      const reasons = v.reasons.map((r) => `${r.tag}+${r.points}`).join(", ") || "no signals";
      return `${ICON[v.verdict] ?? ""} Verdict *${v.verdict}* (score ${v.score}) on ${v.eventType} · event ${v.eventId} · ${reasons}`.trim();
    }
    case "case.resolved.v1": {
      const c = p as unknown as CaseResolved;
      return `✔️ Case ${c.caseId} resolved as *${c.outcome}* by ${c.analyst}`;
    }
    case "label.recorded.v1": {
      const l = p as unknown as LabelRecorded;
      return `🏷️ Label *${l.outcome}* recorded (${l.source}) on event ${l.eventId}`;
    }
    case "alert.anomaly.v1": {
      const a = p as unknown as Anomaly;
      const amt = a.amount !== undefined ? ` — ${a.amount}${a.currency ? ` ${a.currency}` : ""}` : "";
      return `📈 Anomaly: ${a.eventType} for user ${a.userId} is ${a.amountZScore.toFixed(1)}σ from their baseline${amt} · verdict ${a.verdict} · event ${a.eventId}`;
    }
    case "alert.dead_letter.v1": {
      const d = p as unknown as DeadLetter;
      return `🚨 Dead-letter: ${d.source} delivery of ${d.name} (${d.ref}) exhausted ${d.attempts} attempts`;
    }
    default:
      return `Event ${event.name}`;
  }
}

/**
 * The request body a channel expects: Slack wants `{ text }`, Telegram wants `{ chat_id, text }`
 * (plain text — no parse_mode, so tag underscores/asterisks never break formatting), and a generic
 * webhook gets the full event too.
 */
export function bodyFor(type: "slack" | "webhook" | "telegram", event: DomainEvent, text: string, target?: string): string {
  if (type === "slack") return JSON.stringify({ text });
  if (type === "telegram") return JSON.stringify({ chat_id: target, text });
  return JSON.stringify({ type: event.name, text, occurredAt: event.occurredAt, data: event.payload });
}
