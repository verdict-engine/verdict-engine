/**
 * Decision's published contracts — the async surface other contexts may depend on.
 * Import the event name + payload type from here, never from decision/domain.
 */
export { VERDICT_REACHED } from "../domain/events";
export type { VerdictReachedPayload } from "../domain/events";
