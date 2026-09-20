import { describe, expect, it } from "vitest";
import type { PolicyId } from "@shared/domain/ids";
import type { RiskScore } from "@contexts/scoring/application/scorer.port";
import type { Policy } from "./policy";
import { resolveVerdict, validatePolicy } from "./policy";

const policy: Policy = {
  id: "pol_test" as PolicyId,
  version: "v1",
  onError: "fail_open",
  bands: [
    { verdict: "allow", min: 0, max: 24 },
    { verdict: "challenge", min: 25, max: 44 },
    { verdict: "review", min: 45, max: 69, reviewQueue: "risk-ops" },
    { verdict: "deny", min: 70, max: 100 },
  ],
};

const score = (value: number): RiskScore => ({ value, contributions: [], model: "m" });

describe("resolveVerdict", () => {
  it.each([
    [10, "allow"],
    [24, "allow"],
    [25, "challenge"],
    [44, "challenge"],
    [45, "review"],
    [61, "review"],
    [70, "deny"],
    [100, "deny"],
  ])("score %i → %s", (value, expected) => {
    expect(resolveVerdict(policy, score(value)).verdict).toBe(expected);
  });

  it("returns the review queue on a review band", () => {
    expect(resolveVerdict(policy, score(55)).reviewQueue).toBe("risk-ops");
  });

  it("throws on a band gap rather than guessing", () => {
    const gapped: Policy = { ...policy, bands: [{ verdict: "allow", min: 0, max: 10 }] };
    expect(() => resolveVerdict(gapped, score(50))).toThrow();
  });
});

describe("validatePolicy", () => {
  it("accepts a contiguous 0–100 policy", () => {
    expect(validatePolicy(policy)).toBeNull();
  });

  it("rejects a gap between bands", () => {
    const gapped: Policy = {
      ...policy,
      bands: [
        { verdict: "allow", min: 0, max: 24 },
        { verdict: "deny", min: 40, max: 100 },
      ],
    };
    expect(validatePolicy(gapped)).toMatch(/contiguous/);
  });

  it("rejects bands that don't reach 100", () => {
    const short: Policy = { ...policy, bands: [{ verdict: "allow", min: 0, max: 90 }] };
    expect(validatePolicy(short)).toMatch(/end at 100/);
  });

  it("rejects a blank version", () => {
    expect(validatePolicy({ ...policy, version: "  " })).toMatch(/version/);
  });
});
