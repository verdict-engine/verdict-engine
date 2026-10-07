import { describe, expect, it } from "vitest";
import { REASON_CODES, customerMessageFor, reasonCodesFrom } from "./reason-codes";
import type { Verdict } from "./verdict";

describe("reason codes (merchant layer)", () => {
  it("maps rule tags to stable codes, de-duplicated, highest-weight first", () => {
    const codes = reasonCodesFrom([{ tag: "takeover" }, { tag: "amount" }, { tag: "velocity" }, { tag: "velocity" }]);
    expect(codes.map((c) => c.code)).toEqual(["ACCOUNT_TAKEOVER", "AMOUNT_HIGH", "VELOCITY_HIGH"]);
    expect(codes[0].category).toBe("authentication");
  });

  it("maps an unknown tag to RISK_OTHER instead of leaking it, and ignores allow hits", () => {
    expect(reasonCodesFrom([{ tag: "some.internal.tag" }]).map((c) => c.code)).toEqual(["RISK_OTHER"]);
    expect(reasonCodesFrom([{ tag: "list.allow" }])).toEqual([]);
  });

  // Guard against drift: every tag the built-in seed rules + the engine itself can emit must map to a
  // specific code, never the RISK_OTHER catch-all. Add a mapping when you add a seed rule with a new tag.
  it("maps every built-in decline tag to a specific code (none fall through to RISK_OTHER)", () => {
    const builtInTags = [
      "velocity", "login_velocity", "takeover", "no_3ds", "new_device", "shared_device",
      "shared_ip", "ring", "sim_box", "amount", "amount_spike", "anomaly",
      "list.block", "list.watch", "engine.degraded",
    ];
    for (const tag of builtInTags) {
      const [mapped] = reasonCodesFrom([{ tag }]);
      expect(mapped?.code, `tag "${tag}" is unmapped`).toBeDefined();
      expect(mapped.code, `tag "${tag}" falls through to RISK_OTHER`).not.toBe("RISK_OTHER");
      expect(REASON_CODES, `code "${mapped.code}" missing from the published catalog`).toContain(mapped.code);
    }
  });

  it("publishes a catalog with no duplicate codes", () => {
    expect(new Set(REASON_CODES).size).toBe(REASON_CODES.length);
    expect(REASON_CODES).toContain("RISK_OTHER");
  });
});

describe("customer message (end-customer layer)", () => {
  it("is vague per verdict and never names a signal", () => {
    expect(customerMessageFor("deny")).toMatch(/could not be completed/i);
    expect(customerMessageFor("review")).toMatch(/reviewed/i);
    expect(customerMessageFor("challenge")).toMatch(/verification/i);
    expect(customerMessageFor("allow")).toBe("Approved.");
    // The message must not teach a fraudster which rule fired.
    for (const v of ["deny", "review", "challenge", "allow"] as Verdict[]) {
      expect(customerMessageFor(v)).not.toMatch(/velocity|takeover|amount|device|network|rule|score/i);
    }
  });
});
