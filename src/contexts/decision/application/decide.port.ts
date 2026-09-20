import type { Result } from "@shared/domain/result";
import type { RiskEvent } from "@contexts/ingest/application/ingest.port";
import type { Decision } from "../domain/verdict";

/**
 * The engine's single inbound use-case — HTTP, a queue consumer, or gRPC all call
 * THIS and none know how a verdict is produced. The top of the hexagon.
 */
export interface DecidePort {
  /**
   * @param idempotencyKey optional; when a caller retries with the same key, the
   * original decision is returned instead of computing (and logging) a new one.
   * Defaults to the event id.
   */
  decide(
    event: RiskEvent,
    correlationId: string,
    idempotencyKey?: string,
  ): Promise<Result<Decision>>;
}

export const DECIDE_PORT = Symbol("DecidePort");
