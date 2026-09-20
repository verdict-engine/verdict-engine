import { beforeEach, describe, expect, it } from "vitest";
import { mock, type MockProxy } from "vitest-mock-extended";
import type { Clock } from "@shared/ports/clock.port";
import type { EventBus } from "@shared/ports/event-bus.port";
import type { IdGenerator } from "@shared/ports/id-generator.port";
import type { CaseId } from "@shared/domain/ids";
import { CASE_RESOLVED } from "../domain/events";
import type { FraudCase } from "../domain/fraud-case";
import { CaseService } from "./case.service";
import type { CaseRepositoryPort } from "./case-repository.port";

const openCase: FraudCase = {
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

describe("CaseService", () => {
  let cases: MockProxy<CaseRepositoryPort>;
  let bus: MockProxy<EventBus>;
  let ids: MockProxy<IdGenerator>;
  let clock: MockProxy<Clock>;
  let svc: CaseService;

  beforeEach(() => {
    cases = mock<CaseRepositoryPort>();
    bus = mock<EventBus>();
    ids = mock<IdGenerator>();
    clock = mock<Clock>();
    ids.next.mockImplementation((p) => `${p}_x`);
    clock.isoNow.mockReturnValue("2026-01-01T03:00:00Z");
    svc = new CaseService(cases, bus, ids, clock);
  });

  it("opens a case when a review verdict is published", () => {
    svc.onModuleInit();
    const handler = bus.subscribe.mock.calls[0][1];
    return handler({
      name: "verdict.reached.v1",
      id: "evt",
      occurredAt: "t",
      correlationId: "c",
      payload: { verdictId: "vd_9", eventId: "evt_9", verdict: "review", score: 61, reviewQueue: "risk-ops" },
    }).then(() => {
      expect(cases.save).toHaveBeenCalledOnce();
      const saved = cases.save.mock.calls[0][0];
      expect(saved.status).toBe("open");
      expect(saved.queue).toBe("risk-ops");
    });
  });

  it("ignores non-review verdicts", async () => {
    svc.onModuleInit();
    const handler = bus.subscribe.mock.calls[0][1];
    await handler({
      name: "verdict.reached.v1", id: "e", occurredAt: "t", correlationId: "c",
      payload: { verdictId: "vd", eventId: "evt", verdict: "allow", score: 5 },
    });
    expect(cases.save).not.toHaveBeenCalled();
  });

  it("resolves a case and emits case.resolved so a label can be recorded", async () => {
    cases.get.mockResolvedValue(openCase);

    const result = await svc.resolve("cse_1" as CaseId, { outcome: "fraud", analyst: "ana_1" });

    expect(result.status).toBe("resolved");
    expect(cases.save).toHaveBeenCalledOnce();
    expect(bus.publish).toHaveBeenCalledOnce();
    expect(bus.publish.mock.calls[0][0].name).toBe(CASE_RESOLVED);
  });

  it("throws when resolving a case that does not exist", async () => {
    cases.get.mockResolvedValue(null);
    await expect(svc.resolve("cse_missing" as CaseId, { outcome: "fraud", analyst: "a" })).rejects.toThrow();
  });
});
