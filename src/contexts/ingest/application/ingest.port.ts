import type { Result } from "@shared/domain/result";
import type { RiskEvent } from "../domain/risk-event";

/**
 * Ingest's published contract surface. Other contexts import RiskEvent from HERE,
 * never from ingest/domain, so the boundary lint stays satisfied.
 */
export type {
  RiskEvent,
  RiskEventType,
  EventSubject,
  MonetaryAmount,
  Instrument,
} from "../domain/risk-event";

/**
 * IngestPort — the edge that turns an untrusted channel payload into a validated,
 * normalized RiskEvent; the only place raw external shapes exist.
 */
export interface IngestPort {
  normalize(raw: unknown): Result<RiskEvent>;
}

export const INGEST_PORT = Symbol("IngestPort");
