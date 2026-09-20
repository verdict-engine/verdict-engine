import { beforeEach, describe, expect, it } from "vitest";
import { mock, type MockProxy } from "vitest-mock-extended";
import type { Clock } from "@shared/ports/clock.port";
import type { EventBus } from "@shared/ports/event-bus.port";
import type { IdGenerator } from "@shared/ports/id-generator.port";
import { CASE_RESOLVED } from "@contexts/cases/application/case.contracts";
import { LABEL_RECORDED } from "../domain/events";
import { FeedbackService } from "./feedback.service";
import type { FeedbackPort } from "./feedback.port";

describe("FeedbackService", () => {
  let feedback: MockProxy<FeedbackPort>;
  let bus: MockProxy<EventBus>;
  let clock: MockProxy<Clock>;
  let ids: MockProxy<IdGenerator>;
  let svc: FeedbackService;

  beforeEach(() => {
    feedback = mock<FeedbackPort>();
    bus = mock<EventBus>();
    clock = mock<Clock>();
    ids = mock<IdGenerator>();
    clock.isoNow.mockReturnValue("2026-01-01T00:00:00Z");
    ids.next.mockReturnValue("id_1");
    svc = new FeedbackService(feedback, bus, clock, ids);
    svc.onModuleInit();
  });

  const emit = (outcome: string) =>
    bus.subscribe.mock.calls[0][1]({
      name: CASE_RESOLVED, id: "e", occurredAt: "t", correlationId: "c",
      payload: { caseId: "cse_1", eventId: "evt_1", outcome, analyst: "ana_1" },
    });

  it("records an analyst label when a case is resolved fraud/legit", async () => {
    await emit("fraud");
    expect(feedback.record).toHaveBeenCalledWith({
      eventId: "evt_1", outcome: "fraud", source: "analyst", at: "2026-01-01T00:00:00Z",
    });
  });

  it("broadcasts label.recorded so scoring and analytics can learn from it", async () => {
    await emit("fraud");
    expect(bus.publish).toHaveBeenCalledWith(
      expect.objectContaining({
        name: LABEL_RECORDED,
        payload: { eventId: "evt_1", outcome: "fraud", source: "analyst" },
      }),
    );
  });

  it("records no label for an inconclusive resolution", async () => {
    await emit("inconclusive");
    expect(feedback.record).not.toHaveBeenCalled();
    expect(bus.publish).not.toHaveBeenCalled();
  });
});
