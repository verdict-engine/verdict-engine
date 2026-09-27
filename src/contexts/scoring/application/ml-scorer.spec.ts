import { describe, expect, it } from "vitest";
import type { FeatureSnapshot } from "@contexts/feature-store/application/feature-store.port";
import type { RuleHit } from "@contexts/rules/application/rules-engine.port";
import { MlScorer } from "./ml-scorer.service";
import { BundledModelSource } from "./bundled-model-source";

const snapshot = (over: Partial<{ impossibleTravel: boolean; mismatch: boolean; attempts2m: number; zScore: number; ringSize: number }> = {}): FeatureSnapshot => ({
  velocity: { attemptsLast2m: over.attempts2m ?? 0, attemptsLast24h: 0, amountLast1h: 0 },
  device: { firstSeen: false, usersOnDevice: 0, fingerprintFirstSeen: false, usersOnFingerprint: 0, fingerprintDeviceMismatch: over.mismatch ?? false },
  geo: { ipSimMismatch: false, impossibleTravel: over.impossibleTravel ?? false, countryChanged: false },
  graph: { usersOnDevice: 0, usersOnIp: 0, usersOnPhone: 0, devicesOnUser: 0, ringSize: over.ringSize ?? 0 },
  anomaly: { amountZScore: over.zScore ?? 0, amountMean: 0, samples: 0 },
});

const hit = (weight: number): RuleHit => ({ ruleId: "r", tag: "takeover", weight });

describe("MlScorer", () => {
  const scorer = new MlScorer(new BundledModelSource());

  it("returns a low score for a clean event", async () => {
    const r = await scorer.score([], snapshot());
    expect(r.value).toBeLessThan(20);
    expect(r.model).toMatch(/^logreg@/);
  });

  it("returns a high score when strong risk signals stack up", async () => {
    const r = await scorer.score([hit(60)], snapshot({ impossibleTravel: true, mismatch: true, attempts2m: 8, zScore: 5, ringSize: 8 }));
    expect(r.value).toBeGreaterThan(70);
  });

  it("scores monotonically — adding a risk signal never lowers the score", async () => {
    const base = (await scorer.score([], snapshot())).value;
    const withTravel = (await scorer.score([], snapshot({ impossibleTravel: true }))).value;
    const withBoth = (await scorer.score([], snapshot({ impossibleTravel: true, mismatch: true }))).value;
    expect(withTravel).toBeGreaterThanOrEqual(base);
    expect(withBoth).toBeGreaterThanOrEqual(withTravel);
  });

  it("attributes the score to the driving features, summing to about the value", async () => {
    const r = await scorer.score([hit(50)], snapshot({ impossibleTravel: true, mismatch: true, zScore: 4 }));
    expect(r.contributions.length).toBeGreaterThan(0);
    expect(r.contributions.some((c) => c.tag.includes("impossibleTravel"))).toBe(true);
    const sum = r.contributions.reduce((s, c) => s + c.points, 0);
    expect(Math.abs(sum - r.value)).toBeLessThanOrEqual(3); // rounding slack
  });
});
