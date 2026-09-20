import { describe, expect, it } from "vitest";
import { emptyModel, recordLabel, weightOf } from "./model";

describe("adaptive model", () => {
  it("credits every fired tag with the label", () => {
    let m = emptyModel();
    m = recordLabel(m, ["velocity", "takeover"], "fraud");
    m = recordLabel(m, ["velocity"], "legit");
    expect(m.tags.velocity).toEqual({ fraud: 1, legit: 1 });
    expect(m.tags.takeover).toEqual({ fraud: 1, legit: 0 });
  });

  it("does not mutate the input model", () => {
    const original = emptyModel();
    recordLabel(original, ["velocity"], "fraud");
    expect(original.tags.velocity).toBeUndefined();
  });

  it("weights a predictive tag high once it has enough labels", () => {
    const w = weightOf({ fraud: 9, legit: 1 });
    expect(w.trusted).toBe(true);
    expect(w.weight).toBeGreaterThan(35);
  });

  it("weights a benign tag low", () => {
    const w = weightOf({ fraud: 0, legit: 10 });
    expect(w.trusted).toBe(true);
    expect(w.weight).toBeLessThan(5);
  });

  it("distrusts a tag with too few labels", () => {
    expect(weightOf({ fraud: 1, legit: 0 }).trusted).toBe(false);
  });
});
