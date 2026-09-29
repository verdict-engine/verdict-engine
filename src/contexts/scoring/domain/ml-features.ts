import type { FeatureSnapshot } from "@contexts/feature-store/application/feature-store.port";
import type { RuleHit } from "@contexts/rules/application/rules-engine.port";

/**
 * The canonical feature vector the ML scorer consumes — the SAME extraction is used to train the
 * model (on synthetic data) and to serve it, so training and inference can never drift. Each feature
 * is scaled to roughly [0, 1] so the learned weights are comparable and the logistic fit is stable.
 * Order is load-bearing: it matches the weights in the trained model.
 */
export const ML_FEATURE_NAMES = [
  "velocity.attemptsLast2m",
  "velocity.attemptsLast24h",
  "velocity.amountLast1h",
  "device.firstSeen",
  "device.usersOnDevice",
  "device.usersOnFingerprint",
  "device.fingerprintDeviceMismatch",
  "geo.impossibleTravel",
  "geo.countryChanged",
  "geo.ipSimMismatch",
  "graph.ringSize",
  "graph.usersOnIp",
  "anomaly.amountZScore",
  "rules.score",
] as const;

const clamp01 = (n: number): number => Math.max(0, Math.min(1, n));
const bool = (b: boolean): number => (b ? 1 : 0);

/** Sum of matched rule weights — the hand-rules' opinion, fed to the model as one signal. */
export function ruleScore(hits: RuleHit[]): number {
  return hits.reduce((s, h) => s + h.weight, 0);
}

/**
 * The fixed-order, scaled feature vector from a pre-summed rule score + a feature snapshot. This is
 * the single extractor shared by serving ({@link mlFeatureVector}) and offline training/export, so a
 * model trained on exported history uses exactly the same features it will be served on — no drift.
 * The rule score is passed as a number so a replay sample (which stores the score, not the raw hits)
 * can be turned into a training row.
 */
export function mlVector(ruleScoreValue: number, f: FeatureSnapshot): number[] {
  return [
    clamp01(f.velocity.attemptsLast2m / 10),
    clamp01(f.velocity.attemptsLast24h / 50),
    clamp01(f.velocity.amountLast1h / 10_000),
    bool(f.device.firstSeen),
    clamp01(f.device.usersOnDevice / 10),
    clamp01(f.device.usersOnFingerprint / 10),
    bool(f.device.fingerprintDeviceMismatch),
    bool(f.geo.impossibleTravel),
    bool(f.geo.countryChanged),
    bool(f.geo.ipSimMismatch),
    clamp01((f.graph?.ringSize ?? 0) / 10),
    clamp01((f.graph?.usersOnIp ?? 0) / 10),
    clamp01((f.anomaly?.amountZScore ?? 0) / 5),
    clamp01(ruleScoreValue / 100),
  ];
}

/** Extract the fixed-order, scaled feature vector from a snapshot + rule hits. Pure and total. */
export function mlFeatureVector(hits: RuleHit[], f: FeatureSnapshot): number[] {
  return mlVector(ruleScore(hits), f);
}

export const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

/** The shape of a trained logistic-regression model. */
export interface MlModel {
  readonly weights: number[];
  readonly bias: number;
  readonly featureNames: readonly string[];
  readonly trainedAt: string;
  readonly metrics: { readonly auc: number; readonly accuracy: number; readonly samples: number };
}

/**
 * Validate an untrusted model (e.g. one just fetched from a cloud URL) before it's allowed to serve.
 * The feature names and their ORDER must match this engine's extractor exactly — a model trained on a
 * different or reordered feature set would silently misfire — and every weight must be a finite number.
 * Returns the model when safe, or null to reject it (the caller keeps the last-known-good weights).
 */
export function validateModel(raw: unknown): MlModel | null {
  if (typeof raw !== "object" || raw === null) return null;
  const m = raw as Partial<MlModel>;
  if (!Array.isArray(m.weights) || typeof m.bias !== "number" || !Number.isFinite(m.bias)) return null;
  if (!Array.isArray(m.featureNames) || m.featureNames.length !== ML_FEATURE_NAMES.length) return null;
  if (!ML_FEATURE_NAMES.every((name, i) => m.featureNames?.[i] === name)) return null;
  if (m.weights.length !== ML_FEATURE_NAMES.length || !m.weights.every((w) => typeof w === "number" && Number.isFinite(w))) return null;
  return {
    weights: m.weights,
    bias: m.bias,
    featureNames: m.featureNames,
    trainedAt: typeof m.trainedAt === "string" ? m.trainedAt : "unknown",
    metrics: {
      auc: Number(m.metrics?.auc) || 0,
      accuracy: Number(m.metrics?.accuracy) || 0,
      samples: Number(m.metrics?.samples) || 0,
    },
  };
}
