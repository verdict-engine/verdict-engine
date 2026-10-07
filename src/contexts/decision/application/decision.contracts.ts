/**
 * Decision's published contracts — the async surface other contexts may depend on.
 * Import the event name + payload type from here, never from decision/domain.
 */
export { VERDICT_REACHED } from "../domain/events";
export type { VerdictReachedPayload } from "../domain/events";

/** The published reason-code catalog — the stable contract integrators (and the docs/Swagger) depend on. */
export { REASON_CODES, REASON_CODE_CATALOG } from "../domain/reason-codes";
export type { ReasonCode, ReasonCategory } from "../domain/reason-codes";
