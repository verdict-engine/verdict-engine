import { beforeEach, describe, expect, it } from "vitest";
import { mock } from "vitest-mock-extended";
import type { Clock } from "@shared/ports/clock.port";
import type { IdGenerator } from "@shared/ports/id-generator.port";
import { IngestService } from "./ingest.service";

describe("IngestService.normalize", () => {
  let svc: IngestService;

  beforeEach(() => {
    const ids = mock<IdGenerator>();
    ids.next.mockImplementation((p) => `${p}_gen`);
    const clock = mock<Clock>();
    clock.isoNow.mockReturnValue("2026-01-01T00:00:00Z");
    svc = new IngestService(ids, clock);
  });

  it("normalizes a valid card event and whitelists fields", () => {
    const r = svc.normalize({
      type: "card.authorize",
      amount: 4900,
      currency: "usd",
      subject: { userId: "usr_1", deviceId: "dev_1", channel: "visa" },
      instrument: { kind: "card", threeDS: false, bin: "424242" },
      evil: "should be dropped at top level",
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.value.type).toBe("card.authorize");
    expect(r.value.money).toEqual({ amount: 4900, currency: "USD" });
    expect(r.value.instrument?.threeDS).toBe(false);
    expect(r.value.id).toBe("evt_gen"); // generated when absent
    expect(r.value.occurredAt).toBe("2026-01-01T00:00:00Z");
    expect(Object.keys(r.value)).not.toContain("evil");
  });

  it("rejects an unknown event type", () => {
    const r = svc.normalize({ type: "nope", subject: { userId: "u" } });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("INGEST_UNKNOWN_TYPE");
  });

  it("rejects a missing subject", () => {
    const r = svc.normalize({ type: "card.authorize" });
    expect(r.ok).toBe(false);
  });

  it("rejects a negative amount", () => {
    const r = svc.normalize({
      type: "card.authorize",
      amount: -5,
      currency: "USD",
      subject: { userId: "u" },
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.error.code).toBe("INGEST_INVALID");
  });

  it("rejects a non-object payload", () => {
    expect(svc.normalize("nope").ok).toBe(false);
    expect(svc.normalize(null).ok).toBe(false);
  });
});
