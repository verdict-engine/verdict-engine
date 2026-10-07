import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * Shadow mode end to end: score live traffic without enforcing, then prove the comparison report
 * matures as a chargeback label arrives — the exact "would Verdict have caught it" story that wins a
 * switch. Also checks the three reason-code layers appear on a verdict.
 */
describe("shadow mode + reason codes (e2e)", () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();
  let token: string;
  let key: string;

  // A first-seen device + geo mismatch on a large amount → the takeover + amount rules → "review".
  const riskyEvent = (userId: string) => ({
    type: "card.authorize",
    amount: 5250,
    currency: "USD",
    subject: { userId, deviceId: `dev_${userId}`, phone: "+15550000001" },
    attributes: { geoMismatch: true },
    instrument: { kind: "card", threeDS: false },
  });

  const decide = (userId: string, mode?: "shadow" | "enforce") => {
    const req = request(server()).post("/v1/decisions").set({ "x-api-key": key });
    if (mode) req.set({ "x-verdict-mode": mode });
    return req.send(riskyEvent(userId));
  };

  const report = (days = 1) =>
    request(server()).get(`/v1/shadow/report?days=${days}`).set({ authorization: `Bearer ${token}` });

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const reg = await request(server()).post("/v1/auth/register").send({ email: "shadow@v.dev", password: "supersecret1" });
    token = reg.body.token;
    key = (await request(server()).post("/v1/apikeys").set({ authorization: `Bearer ${token}` }).send({ name: "shadow" })).body.plaintext;
  });

  afterAll(async () => {
    await app.close();
  });

  it("returns the three reason-code layers on a verdict", async () => {
    const res = await decide("rc-user", "enforce");
    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe("review");
    // Layer 1: analyst tags. Layer 2: merchant codes. Layer 3: customer message.
    expect(res.body.reasons.map((r: { tag: string }) => r.tag)).toEqual(expect.arrayContaining(["takeover", "amount"]));
    expect(res.body.reasonCodes.map((c: { code: string }) => c.code)).toEqual(expect.arrayContaining(["ACCOUNT_TAKEOVER", "AMOUNT_HIGH"]));
    expect(res.body.customerMessage).toMatch(/reviewed/i);
    expect(res.body.shadow).toBeUndefined(); // enforced
  });

  it("scores in shadow mode without enforcing, and the report matures when a label lands", async () => {
    const shadow = await decide("shadow-user", "shadow");
    expect(shadow.status).toBe(200);
    expect(shadow.body.verdict).toBe("review");
    expect(shadow.body.shadow).toBe(true);
    const eventId = shadow.body.eventId;

    // Before any label: the shadow decision is counted, but no fraud confirmed yet.
    const before = (await report()).body;
    expect(before.total).toBe(1); // only the shadow decision, not the enforced one from the first test
    expect(before.byVerdict.review).toBe(1);
    expect(before.wouldBlockRate).toBe(1); // review counts as "would have blocked"
    expect(before.labeledFraud).toBe(0);

    // A chargeback arrives weeks later → that event was fraud. The report now shows it was caught.
    await request(server()).post("/v1/labels/chargeback").set({ "x-api-key": key }).send({ eventId }).expect(202);
    const after = (await report()).body;
    expect(after.labeledFraud).toBe(1);
    expect(after.caught).toBe(1);
    expect(after.missed).toBe(0);
    expect(after.catchRate).toBe(1);
  });
});
