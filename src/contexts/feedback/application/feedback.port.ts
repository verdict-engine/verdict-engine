/**
 * Closes the loop: analyst decisions and chargebacks become labels on past events,
 * which train the scorer and let a proposed rule be backtested against real history.
 */
export interface Label {
  readonly eventId: string;
  readonly outcome: "fraud" | "legit";
  readonly source: "analyst" | "chargeback";
  readonly at: string;
}

export interface FeedbackPort {
  record(label: Label): Promise<void>;
  since(iso: string): Promise<Label[]>;
}

export const FEEDBACK_PORT = Symbol("FeedbackPort");
