import { describe, expect, it } from "vitest";
import { applyLabel, applyResolution, applyVerdict, emptySummary, falsePositiveRate } from "./summary";

describe("analytics summary", () => {
  it("folds a verdict into totals, buckets, tags and by-day", () => {
    const s = emptySummary();
    applyVerdict(s, { verdict: "review", score: 55, reasons: [{ tag: "takeover", points: 33 }] }, "2026-09-17T10:00:00Z");

    expect(s.totals.decisions).toBe(1);
    expect(s.totals.byVerdict.review).toBe(1);
    expect(s.scoreBuckets[5]).toBe(1); // 55 → bucket 5
    expect(s.topTags.takeover).toBe(1);
    expect(s.byDay["2026-09-17"]).toMatchObject({ total: 1, review: 1 });
  });

  it("ignores negative (fallback) scores in the buckets", () => {
    const s = emptySummary();
    applyVerdict(s, { verdict: "allow", score: -1, reasons: [] }, "2026-09-17T10:00:00Z");
    expect(s.scoreBuckets.every((b) => b === 0)).toBe(true);
    expect(s.totals.decisions).toBe(1);
  });

  it("computes the false-positive rate from resolved cases", () => {
    const s = emptySummary();
    applyResolution(s, "fraud");
    applyResolution(s, "legit");
    applyResolution(s, "legit");
    applyResolution(s, "inconclusive");
    expect(s.cases.resolved).toBe(4);
    expect(falsePositiveRate(s)).toBeCloseTo(2 / 3); // legit / (fraud+legit)
  });

  it("is 0% false-positive with no decided cases", () => {
    expect(falsePositiveRate(emptySummary())).toBe(0);
  });

  it("counts labels by outcome and source, including chargebacks", () => {
    const s = emptySummary();
    applyLabel(s, { outcome: "fraud", source: "analyst" });
    applyLabel(s, { outcome: "fraud", source: "chargeback" });
    applyLabel(s, { outcome: "legit", source: "analyst" });
    expect(s.labels).toEqual({ fraud: 2, legit: 1, analyst: 2, chargeback: 1 });
  });
});
