import type { DeviceId, EventId, UserId } from "@shared/domain/ids";

/**
 * RiskEvent — the one normalized shape the whole engine reasons about. New event types
 * are additive (add a `type`, map its fields) with no downstream context changes.
 */
export interface RiskEvent {
  readonly id: EventId;
  readonly type: RiskEventType;
  readonly occurredAt: string;
  readonly subject: EventSubject;
  /** Present for value-bearing events (payments, withdrawals). */
  readonly money?: MonetaryAmount;
  /** Card details for card/credit events — never a PAN, only safe metadata. */
  readonly instrument?: Instrument;
  /** Any additional channel-specific attributes, validated at the edge. */
  readonly attributes: Readonly<Record<string, string | number | boolean>>;
}

export type RiskEventType =
  | "card.authorize"
  | "card.capture"
  | "card.refund"
  | "payment.authorize"
  | "wallet.withdraw"
  | "account.login"
  | "order.place";

export interface EventSubject {
  readonly userId: UserId;
  readonly deviceId?: DeviceId;
  readonly ip?: string;
  /** MSISDN (phone number) for mobile-money / telecom rails — a linkable entity and SIM-box signal. */
  readonly phone?: string;
  /** Origin rail, e.g. "visa", "telebirr", "chapa", "web". */
  readonly channel?: string;
}

export interface MonetaryAmount {
  readonly amount: number;
  readonly currency: string;
}

export interface Instrument {
  readonly kind: "card" | "wallet" | "bank";
  /** Card issuer BIN (first 6–8 digits) — safe, non-sensitive. */
  readonly bin?: string;
  readonly issuerCountry?: string;
  readonly threeDS?: boolean;
}
