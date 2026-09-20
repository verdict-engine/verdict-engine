import { describe, expect, it } from "vitest";
import type { Rule } from "./rule";
import { validateRuleset } from "./validate-ruleset";

const rule = (over: Partial<Rule> = {}): Rule => ({
  id: "r1", name: "r1", tag: "velocity", weight: 20,
  condition: { kind: "compare", path: "velocity.attemptsLast2m", op: "gt", value: 4 },
  ...over,
});

describe("validateRuleset", () => {
  it("accepts a well-formed ruleset", () => {
    expect(validateRuleset([rule()])).toBeNull();
  });

  it("accepts an and/or tree over known signals", () => {
    const c: Rule["condition"] = {
      kind: "and",
      all: [
        { kind: "compare", path: "device.firstSeen", op: "eq", value: true },
        { kind: "or", any: [{ kind: "compare", path: "graph.ringSize", op: "gt", value: 6 }] },
      ],
    };
    expect(validateRuleset([rule({ condition: c })])).toBeNull();
  });

  it("rejects a duplicate rule id", () => {
    expect(validateRuleset([rule(), rule()])).toMatch(/duplicate/);
  });

  it("rejects a missing tag", () => {
    expect(validateRuleset([rule({ tag: "" })])).toMatch(/tag/);
  });

  it("rejects an out-of-range weight", () => {
    expect(validateRuleset([rule({ weight: 200 })])).toMatch(/weight/);
  });

  it("rejects an unknown signal path", () => {
    expect(validateRuleset([rule({ condition: { kind: "compare", path: "wat.nope", op: "gt", value: 1 } })])).toMatch(/unknown signal/);
  });

  it("rejects an unknown operator", () => {
    // deliberately invalid op
    const bad = { kind: "compare", path: "event.amount", op: "between", value: 1 } as unknown as Rule["condition"];
    expect(validateRuleset([rule({ condition: bad })])).toMatch(/operator/);
  });
});
