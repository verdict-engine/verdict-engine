import type { RiskEvent } from "@contexts/ingest/application/ingest.port";

/**
 * The request as it is safe to persist in the activity log and show to operators.
 * Direct identifiers that compliance requires scrubbed from logs (full phone numbers, full IPs)
 * are masked here, at write time, so the log itself never holds them — not just the display.
 * PANs are never present: ingest keeps only the BIN. userId/deviceId are pseudonymous keys kept
 * for investigation and are removable via right-to-erasure.
 */
export interface SanitizedRequest {
  readonly type: string;
  readonly occurredAt: string;
  readonly subject: {
    readonly userId: string;
    readonly deviceId?: string;
    /** Masked, e.g. "196.188.•.•". */
    readonly ip?: string;
    /** Masked, e.g. "+2519•••••44". */
    readonly phone?: string;
    readonly channel?: string;
  };
  readonly amount?: number;
  readonly currency?: string;
  readonly instrument?: {
    readonly kind: string;
    /** Card BIN only — never a full PAN. */
    readonly bin?: string;
    readonly issuerCountry?: string;
    readonly threeDS?: boolean;
  };
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

/** Keep the first two octets of an IPv4 / the first hextet of an IPv6; mask the rest. */
export function maskIp(ip: string): string {
  if (ip.includes(":")) {
    const [first] = ip.split(":");
    return `${first}:•`;
  }
  const parts = ip.split(".");
  if (parts.length !== 4) return "•";
  return `${parts[0]}.${parts[1]}.•.•`;
}

/** Keep the leading country-code digits and the last two; mask the middle. */
export function maskPhone(phone: string): string {
  const trimmed = phone.trim();
  if (trimmed.length <= 4) return "•".repeat(trimmed.length);
  const head = trimmed.startsWith("+") ? trimmed.slice(0, 4) : trimmed.slice(0, 2);
  const tail = trimmed.slice(-2);
  const hidden = Math.max(trimmed.length - head.length - tail.length, 1);
  return `${head}${"•".repeat(hidden)}${tail}`;
}

export function sanitizeRequest(event: RiskEvent): SanitizedRequest {
  return {
    type: event.type,
    occurredAt: event.occurredAt,
    subject: {
      userId: event.subject.userId,
      deviceId: event.subject.deviceId,
      ip: event.subject.ip ? maskIp(event.subject.ip) : undefined,
      phone: event.subject.phone ? maskPhone(event.subject.phone) : undefined,
      channel: event.subject.channel,
    },
    amount: event.money?.amount,
    currency: event.money?.currency,
    instrument: event.instrument
      ? {
          kind: event.instrument.kind,
          bin: event.instrument.bin,
          issuerCountry: event.instrument.issuerCountry,
          threeDS: event.instrument.threeDS,
        }
      : undefined,
    attributes: event.attributes,
  };
}
