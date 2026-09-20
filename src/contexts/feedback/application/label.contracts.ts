/**
 * Feedback's published contract — the async surface other contexts depend on.
 * Import the event name + payload from here, never from feedback/domain.
 */
export { LABEL_RECORDED } from "../domain/events";
export type { LabelRecordedPayload } from "../domain/events";
