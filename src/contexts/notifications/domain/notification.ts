import { randomBytes } from "node:crypto";

/** Engine events an alert channel can subscribe to. */
export const NOTIFY_EVENTS = [
  "verdict.reached.v1",
  "case.resolved.v1",
  "label.recorded.v1",
  "alert.anomaly.v1",
  "alert.dead_letter.v1",
] as const;
export type NotifyEvent = (typeof NOTIFY_EVENTS)[number];

export type ChannelType = "slack" | "webhook" | "telegram";

/** Verdict severities, ranked so a channel can subscribe to "this bad or worse". */
export const VERDICT_RANK: Record<string, number> = { allow: 0, challenge: 1, review: 2, deny: 3 };

export interface NotificationChannel {
  readonly id: string;
  readonly type: ChannelType;
  /**
   * Where to POST. Slack incoming-webhook URL, a generic HTTPS endpoint, or a Telegram
   * `https://api.telegram.org/bot<token>/sendMessage` URL. Sensitive (holds the token) — masked in views.
   */
  readonly url: string;
  /** Telegram chat id (which chat to post to). Only used by the telegram type. */
  readonly target?: string;
  readonly events: NotifyEvent[];
  /** For verdict.reached: only notify at or above this verdict severity. */
  readonly minVerdict?: string;
  /** Max alerts delivered to this channel per minute; excess is dropped. undefined = env default, 0 = unlimited. */
  readonly throttlePerMin?: number;
  readonly active: boolean;
  readonly createdAt: string;
  readonly createdBy: string;
  lastStatus?: "delivered" | "failed";
  lastAt?: string;
  lastError?: string;
  failures: number;
}

/** What the dashboard sees — no full URL (a Slack webhook URL is a secret). */
export interface ChannelView {
  id: string;
  type: ChannelType;
  urlHint: string;
  target?: string;
  events: NotifyEvent[];
  minVerdict?: string;
  throttlePerMin?: number;
  active: boolean;
  createdAt: string;
  createdBy: string;
  lastStatus?: "delivered" | "failed";
  lastAt?: string;
  failures: number;
}

/** Show enough of the URL to recognize it, never enough to post to it. */
export function maskUrl(url: string): string {
  try {
    const u = new URL(url);
    return `${u.protocol}//${u.host}/…`;
  } catch {
    return "…";
  }
}

export const newChannelId = (): string => `ntf_${randomBytes(9).toString("hex")}`;

export function summarizeChannel(c: NotificationChannel): ChannelView {
  return {
    id: c.id,
    type: c.type,
    urlHint: maskUrl(c.url),
    target: c.target,
    events: c.events,
    minVerdict: c.minVerdict,
    throttlePerMin: c.throttlePerMin,
    active: c.active,
    createdAt: c.createdAt,
    createdBy: c.createdBy,
    lastStatus: c.lastStatus,
    lastAt: c.lastAt,
    failures: c.failures,
  };
}
