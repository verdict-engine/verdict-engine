import type { MlModel } from "../domain/ml-features";

/**
 * Where the ML scorer's weights come from. The default source returns the weights bundled in the
 * image; a remote source loads them from a cloud URL. Both return null on failure so the scorer can
 * fall back to the last-known-good model — the decision path never depends on a network call.
 */
export interface ModelSource {
  /** A human label for logs/metrics, e.g. "bundled" or "remote". */
  readonly kind: string;
  load(): Promise<MlModel | null>;
}

export const MODEL_SOURCE = Symbol("ModelSource");
