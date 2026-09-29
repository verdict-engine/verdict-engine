/**
 * Offline trainer for the ML risk scorer. It generates a synthetic, labelled dataset, fits a
 * logistic-regression model with gradient descent (pure TS, no deps), evaluates it on a holdout,
 * and writes the weights to src/contexts/scoring/model/ml-weights.ts. The engine never trains at
 * runtime — it loads these weights and serves an O(features) dot-product, so inference is fast and
 * the decision path is untouched. Re-run with: npx tsx scripts/train-ml-model.ts
 *
 * The feature order MUST match ML_FEATURE_NAMES in src/contexts/scoring/domain/ml-features.ts.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

const FEATURE_NAMES = [
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
];
const D = FEATURE_NAMES.length;

// A small seeded PRNG (mulberry32) so training is reproducible and the committed weights are stable.
function rng(seed: number): () => number {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const sigmoid = (z: number): number => 1 / (1 + Math.exp(-z));

// The synthetic "ground truth": how the world decides fraud, in scaled feature space. The trained
// model should recover a similar shape. Signs match intuition (spoofing/impossible-travel raise risk).
const TRUE_W = [1.5, 0.8, 1.0, 0.6, 1.2, 1.3, 2.0, 2.2, 0.9, 1.1, 1.4, 1.0, 1.6, 2.5];
const TRUE_B = -6.2;

function sample(rand: () => number): { x: number[]; y: number } {
  const skewed = () => rand() ** 3; // most values low, a long tail high — like real risk features
  const binary = (p: number) => (rand() < p ? 1 : 0);
  const x = [
    skewed(), skewed(), skewed(), // velocity
    binary(0.3), skewed(), skewed(), binary(0.08), // device / fingerprint
    binary(0.05), binary(0.15), binary(0.1), // geo
    skewed(), skewed(), // graph
    skewed(), skewed(), // anomaly z-score, rule score
  ];
  const noise = (rand() - 0.5) * 1.2;
  const logit = TRUE_B + noise + x.reduce((s, xi, i) => s + xi * TRUE_W[i], 0);
  return { x, y: rand() < sigmoid(logit) ? 1 : 0 };
}

function train(data: { x: number[]; y: number }[], epochs: number, lr: number, l2: number): { w: number[]; b: number } {
  let w = new Array(D).fill(0);
  let b = 0;
  for (let e = 0; e < epochs; e++) {
    const gw = new Array(D).fill(0);
    let gb = 0;
    for (const { x, y } of data) {
      const p = sigmoid(b + x.reduce((s, xi, i) => s + xi * w[i], 0));
      const d = p - y;
      for (let i = 0; i < D; i++) gw[i] += d * x[i];
      gb += d;
    }
    const n = data.length;
    for (let i = 0; i < D; i++) w[i] -= lr * (gw[i] / n + l2 * w[i]);
    b -= lr * (gb / n);
  }
  return { w, b };
}

interface ReliabilityBin {
  readonly bin: string;
  readonly meanPred: number;
  readonly fracPos: number;
  readonly n: number;
}
interface Eval {
  readonly auc: number;
  readonly accuracy: number;
  readonly prAuc: number;
  readonly brier: number;
  readonly reliability: ReliabilityBin[];
}

function evaluate(model: { w: number[]; b: number }, data: { x: number[]; y: number }[]): Eval {
  const scored = data.map(({ x, y }) => ({ p: sigmoid(model.b + x.reduce((s, xi, i) => s + xi * model.w[i], 0)), y }));
  const correct = scored.filter((s) => (s.p >= 0.5 ? 1 : 0) === s.y).length;
  const pos = scored.filter((s) => s.y === 1);
  const neg = scored.filter((s) => s.y === 0);

  // ROC-AUC via the rank-sum (Mann–Whitney) identity.
  let wins = 0;
  for (const p of pos) for (const n of neg) wins += p.p > n.p ? 1 : p.p === n.p ? 0.5 : 0;
  const auc = pos.length && neg.length ? wins / (pos.length * neg.length) : 0.5;

  // PR-AUC (average precision) — the metric that matters at a low fraud base rate, where ROC-AUC flatters.
  const byScore = [...scored].sort((a, b) => b.p - a.p);
  let tp = 0;
  let fp = 0;
  let apSum = 0;
  for (const s of byScore) {
    if (s.y === 1) {
      tp += 1;
      apSum += tp / (tp + fp); // precision each time recall increases
    } else {
      fp += 1;
    }
  }
  const prAuc = pos.length ? apSum / pos.length : 0;

  // Brier score — mean squared error of the probability; a proper score for calibration (lower = better).
  const brier = scored.reduce((s, r) => s + (r.p - r.y) ** 2, 0) / (scored.length || 1);

  // Reliability by decile: a calibrated model has predicted ≈ actual fraud rate in each bucket.
  const BINS = 10;
  const reliability: ReliabilityBin[] = Array.from({ length: BINS }, (_, i) => {
    const lo = i / BINS;
    const hi = (i + 1) / BINS;
    const inBin = scored.filter((r) => r.p >= lo && (i === BINS - 1 ? r.p <= hi : r.p < hi));
    const n = inBin.length;
    return {
      bin: `${lo.toFixed(1)}-${hi.toFixed(1)}`,
      meanPred: n ? inBin.reduce((s, r) => s + r.p, 0) / n : 0,
      fracPos: n ? inBin.filter((r) => r.y === 1).length / n : 0,
      n,
    };
  });

  return { auc, accuracy: correct / (data.length || 1), prAuc, brier, reliability };
}

/** Load a real labelled dataset exported by scripts/export-training-data.ts. */
function loadRealDataset(file: string): { x: number[]; y: number }[] {
  const parsed = JSON.parse(readFileSync(file, "utf8")) as { rows?: { x: number[]; y: number }[] };
  const rows = parsed.rows ?? [];
  for (const r of rows) {
    if (!Array.isArray(r.x) || r.x.length !== D) {
      throw new Error(`training row has ${r.x?.length} features, expected ${D} — was it exported by this repo?`);
    }
  }
  return rows;
}

function shuffle(rows: { x: number[]; y: number }[], seed: number): { x: number[]; y: number }[] {
  const rand = rng(seed);
  const a = [...rows];
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function main(): void {
  const dataArg = process.argv.indexOf("--data");
  const dataFile = dataArg !== -1 ? process.argv[dataArg + 1] : undefined;

  const rand = rng(42);
  const all = dataFile
    ? shuffle(loadRealDataset(dataFile), 42)
    : Array.from({ length: 20_000 }, () => sample(rand));

  if (all.length < 50) {
    console.error(`Only ${all.length} rows — not enough to train. Export more labelled history first.`);
    process.exit(1);
  }

  const split = Math.floor(all.length * 0.8);
  const model = train(all.slice(0, split), 400, 0.5, 1e-4);
  const m = evaluate(model, all.slice(split));
  const fraudRate = all.filter((d) => d.y === 1).length / all.length;

  const round = (n: number): number => Math.round(n * 1e6) / 1e6;
  const out = {
    weights: model.w.map(round),
    bias: round(model.b),
    featureNames: FEATURE_NAMES,
    trainedAt: new Date().toISOString().slice(0, 10),
    metrics: { auc: round(m.auc), accuracy: round(m.accuracy), samples: all.length },
  };

  const file = join(__dirname, "..", "src", "contexts", "scoring", "model", "ml-weights.ts");
  const banner =
    "// GENERATED by scripts/train-ml-model.ts — do not edit by hand. Re-run the script to retrain.\n" +
    "import type { MlModel } from \"../domain/ml-features\";\n\n";
  writeFileSync(file, `${banner}export const ML_WEIGHTS: MlModel = ${JSON.stringify(out, null, 2)};\n`);

  const source = dataFile ? `${all.length} REAL labelled rows from ${dataFile}` : `${all.length} synthetic samples`;
  console.log(`Trained on ${source} (fraud rate ${(fraudRate * 100).toFixed(1)}%).`);
  console.log(
    `Holdout: ROC-AUC ${m.auc.toFixed(3)} · PR-AUC ${m.prAuc.toFixed(3)} · accuracy ${(m.accuracy * 100).toFixed(1)}% · Brier ${m.brier.toFixed(4)}`,
  );
  console.log("Calibration (predicted vs actual fraud rate, by decile):");
  for (const r of m.reliability) {
    if (r.n > 0) console.log(`  ${r.bin}  predicted ${r.meanPred.toFixed(2)}  actual ${r.fracPos.toFixed(2)}  (n=${r.n})`);
  }
  if (dataFile && m.auc < 0.65) {
    console.warn(`\nWARNING: ROC-AUC ${m.auc.toFixed(3)} is low for a real model — do not rely on it; gather more or cleaner labels.`);
  }
  console.log(`\nWrote ${file}`);
}

main();
