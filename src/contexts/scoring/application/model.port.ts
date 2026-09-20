export interface TagWeight {
  tag: string;
  fraud: number;
  legit: number;
  /** 0–100 weight derived from how predictive this tag has been of fraud. */
  weight: number;
  /** false until enough labels exist to trust the learned weight. */
  trusted: boolean;
}

/**
 * The adaptive model: per-tag weights learned from resolved-case labels. It's
 * maintained by a projector consuming label events — the feedback loop feeding
 * scoring. The LearnedScorer reads it; a real ML model would sit behind the same port.
 */
export interface ModelPort {
  weights(): Promise<TagWeight[]>;
  weightFor(tag: string): Promise<TagWeight | null>;
}

export const MODEL_PORT = Symbol("ModelPort");
