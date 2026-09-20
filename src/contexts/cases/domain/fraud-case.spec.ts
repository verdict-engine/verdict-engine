import { describe, expect, it } from "vitest";
import type { CaseId } from "@shared/domain/ids";
import { assignCase, resolveCase, type FraudCase } from "./fraud-case";

const base: FraudCase = {
  id: "cse_1" as CaseId,
  eventId: "evt_1",
  verdictId: "vd_1",
  queue: "risk-ops",
  verdict: "review",
  score: 55,
  status: "open",
  openedAt: "2026-01-01T00:00:00Z",
  audit: [{ action: "opened", at: "2026-01-01T00:00:00Z", actor: "system" }],
};

describe("fraud-case transitions", () => {
  it("assigns and appends an audit entry", () => {
    const c = assignCase(base, "ana_1", "2026-01-01T01:00:00Z");
    expect(c.status).toBe("assigned");
    expect(c.assignedTo).toBe("ana_1");
    expect(c.audit).toHaveLength(2);
    expect(c.audit[1]).toMatchObject({ action: "assigned", actor: "ana_1" });
  });

  it("resolves with an outcome and audit entry", () => {
    const c = resolveCase(base, "fraud", "ana_1", "2026-01-01T02:00:00Z", "clear ATO");
    expect(c.status).toBe("resolved");
    expect(c.resolution).toMatchObject({ outcome: "fraud", analyst: "ana_1", note: "clear ATO" });
    expect(c.audit.at(-1)).toMatchObject({ action: "resolved", detail: "fraud" });
  });

  it("refuses to assign or resolve an already-resolved case", () => {
    const resolved = resolveCase(base, "legit", "ana_1", "2026-01-01T02:00:00Z");
    expect(() => assignCase(resolved, "ana_2", "t")).toThrow();
    expect(() => resolveCase(resolved, "fraud", "ana_2", "t")).toThrow();
  });

  it("does not mutate the input case", () => {
    assignCase(base, "ana_1", "t");
    expect(base.status).toBe("open");
    expect(base.audit).toHaveLength(1);
  });
});
