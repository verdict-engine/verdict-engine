import { describe, expect, it } from "vitest";
import { computeBacktest, weightedScore, type BacktestRow } from "./backtest";

describe("weightedScore", () => {
  it("sums weights per tag and clamps to 100", () => {
    expect(weightedScore([{ tag: "a", weight: 28 }, { tag: "b", weight: 33 }])).toBe(61);
    expect(weightedScore([{ tag: "a", weight: 80 }, { tag: "b", weight: 80 }])).toBe(100);
    expect(weightedScore([])).toBe(0);
  });
});

describe("computeBacktest", () => {
  it("scores a candidate that catches a missed fraud without new false positives", () => {
    const rows: BacktestRow[] = [
      { actual: "allow", candidate: "review", label: "fraud" }, // newly caught
      { actual: "allow", candidate: "allow", label: "legit" }, // still fine
      { actual: "review", candidate: "review", label: "fraud" }, // already caught
    ];
    const r = computeBacktest(rows);

    expect(r.labeled).toBe(3);
    expect(r.candidate.truePositives).toBe(2);
    expect(r.candidate.falsePositives).toBe(0);
    expect(r.baseline.truePositives).toBe(1);
    expect(r.delta.fraudCaught).toBe(1);
    expect(r.delta.falsePositives).toBe(0);
    expect(r.delta.flips).toBe(1);
    expect(r.candidate.recall).toBe(1);
  });

  it("penalises a candidate that adds false positives", () => {
    const rows: BacktestRow[] = [
      { actual: "allow", candidate: "deny", label: "legit" },
      { actual: "allow", candidate: "allow", label: "legit" },
    ];
    const r = computeBacktest(rows);

    expect(r.candidate.falsePositives).toBe(1);
    expect(r.candidate.falsePositiveRate).toBe(0.5);
    expect(r.delta.falsePositives).toBe(1);
    expect(r.delta.fraudCaught).toBe(0);
  });

  it("treats challenge and review as flags, allow as a pass", () => {
    const rows: BacktestRow[] = [
      { actual: "allow", candidate: "challenge", label: "fraud" },
    ];
    expect(computeBacktest(rows).candidate.truePositives).toBe(1);
  });
});
