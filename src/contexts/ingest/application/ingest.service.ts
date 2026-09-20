import { Inject, Injectable } from "@nestjs/common";
import { CLOCK, type Clock } from "@shared/ports/clock.port";
import { ID_GENERATOR, type IdGenerator } from "@shared/ports/id-generator.port";
import type { DeviceId, EventId, UserId } from "@shared/domain/ids";
import { DomainError, type Result, err, ok } from "@shared/domain/result";
import type {
  Instrument,
  MonetaryAmount,
  RiskEvent,
  RiskEventType,
} from "../domain/risk-event";
import type { IngestPort } from "./ingest.port";

const KNOWN_TYPES: ReadonlySet<string> = new Set<RiskEventType>([
  "card.authorize",
  "card.capture",
  "card.refund",
  "payment.authorize",
  "wallet.withdraw",
  "account.login",
  "order.place",
]);

type Raw = Record<string, unknown>;

/**
 * Validates an untrusted payload at the edge into a RiskEvent. Whitelists fields
 * (never spreads the raw body) and fails closed on unknown/invalid shapes.
 */
@Injectable()
export class IngestService implements IngestPort {
  constructor(
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  normalize(raw: unknown): Result<RiskEvent> {
    if (!isObject(raw)) {
      return err(new DomainError("INGEST_INVALID", "payload must be an object"));
    }
    const type = raw.type;
    if (typeof type !== "string" || !KNOWN_TYPES.has(type)) {
      return err(new DomainError("INGEST_UNKNOWN_TYPE", `unknown event type: ${String(type)}`));
    }
    const subject = raw.subject;
    if (!isObject(subject) || typeof subject.userId !== "string") {
      return err(new DomainError("INGEST_INVALID", "subject.userId is required"));
    }

    const money = this.readMoney(raw);
    if (money.ok === false) return money;

    const event: RiskEvent = {
      id: (typeof raw.id === "string" ? raw.id : this.ids.next("evt")) as EventId,
      type: type as RiskEventType,
      occurredAt: typeof raw.occurredAt === "string" ? raw.occurredAt : this.clock.isoNow(),
      subject: {
        userId: subject.userId as UserId,
        deviceId: typeof subject.deviceId === "string" ? (subject.deviceId as DeviceId) : undefined,
        ip: typeof subject.ip === "string" ? subject.ip : undefined,
        phone: typeof subject.phone === "string" ? subject.phone : undefined,
        channel: typeof subject.channel === "string" ? subject.channel : undefined,
      },
      money: money.value,
      instrument: this.readInstrument(raw),
      attributes: this.readAttributes(raw.attributes),
    };
    return ok(event);
  }

  private readMoney(raw: Raw): Result<MonetaryAmount | undefined> {
    if (raw.amount === undefined && raw.currency === undefined) return ok(undefined);
    if (typeof raw.amount !== "number" || !Number.isFinite(raw.amount) || raw.amount < 0) {
      return err(new DomainError("INGEST_INVALID", "amount must be a non-negative number"));
    }
    if (typeof raw.currency !== "string" || raw.currency.length !== 3) {
      return err(new DomainError("INGEST_INVALID", "currency must be a 3-letter code"));
    }
    return ok({ amount: raw.amount, currency: raw.currency.toUpperCase() });
  }

  private readInstrument(raw: Raw): Instrument | undefined {
    const i = raw.instrument;
    if (!isObject(i)) return undefined;
    const kind = i.kind;
    if (kind !== "card" && kind !== "wallet" && kind !== "bank") return undefined;
    return {
      kind,
      bin: typeof i.bin === "string" ? i.bin.slice(0, 8) : undefined,
      issuerCountry: typeof i.issuerCountry === "string" ? i.issuerCountry : undefined,
      threeDS: typeof i.threeDS === "boolean" ? i.threeDS : undefined,
    };
  }

  private readAttributes(a: unknown): Record<string, string | number | boolean> {
    if (!isObject(a)) return {};
    const out: Record<string, string | number | boolean> = {};
    for (const [k, v] of Object.entries(a)) {
      if (typeof v === "string" || typeof v === "number" || typeof v === "boolean") {
        out[k] = v;
      }
    }
    return out;
  }
}

function isObject(v: unknown): v is Raw {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}
