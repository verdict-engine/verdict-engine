import { describe, expect, it } from "vitest";
import { emptyStats, observe, stddev, zScore } from "./stats";

const from = (xs: number[]) => xs.reduce(observe, emptyStats());

describe("anomaly stats", () => {
  it("tracks a running mean", () => {
    expect(from([100, 120, 110, 130]).mean).toBeCloseTo(115);
  });

  it("computes sample standard deviation", () => {
    // deviations ±15, ±5 → variance 500/3 → sd ≈ 12.91
    expect(stddev(from([100, 120, 110, 130]))).toBeCloseTo(12.91, 1);
  });

  it("flags an amount far from the baseline", () => {
    expect(zScore(from([100, 120, 110, 130]), 5000)).toBeGreaterThan(3);
  });

  it("does not flag an in-line amount", () => {
    expect(Math.abs(zScore(from([100, 120, 110, 130]), 118))).toBeLessThan(1);
  });

  it("returns 0 before a baseline exists", () => {
    expect(zScore(from([100, 120]), 9000)).toBe(0);
  });

  it("returns 0 when the history has no variance", () => {
    expect(zScore(from([100, 100, 100]), 5000)).toBe(0);
  });
});
