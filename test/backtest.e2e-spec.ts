import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

const tick = () => new Promise((r) => setTimeout(r, 25));

describe("policy backtest (e2e)", () => {
  let app: INestApplication;
  let token: string;
  let apiKey: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const reg = await request(app.getHttpServer())
      .post("/v1/auth/register")
      .send({ email: "risk@bank.com", password: "supersecret" });
    token = reg.body.token;

    const key = await request(app.getHttpServer())
      .post("/v1/apikeys")
      .set({ authorization: `Bearer ${token}` })
      .send({ name: "gateway" });
    apiKey = key.body.plaintext;
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const authed = (r: request.Test) => r.set("authorization", `Bearer ${token}`);

  it("guards the backtest endpoint", async () => {
    expect((await request(server()).post("/v1/backtest").send({ eventType: "card.authorize" })).status).toBe(401);
  });

  it("replays a candidate policy over labeled history and reports the impact", async () => {
    const decision = await request(server())
      .post("/v1/decisions")
      .set({ "x-api-key": apiKey })
      .send({
        type: "card.authorize",
        amount: 2500,
        currency: "USD",
        subject: { userId: "usr_bt", deviceId: "dev_bt", channel: "visa" },
        instrument: { kind: "card", threeDS: false },
        attributes: { geoMismatch: true },
      });
    expect(decision.body.verdict).toBe("review");

    // A chargeback makes it ground-truth fraud — the review was correct.
    await request(server()).post("/v1/labels/chargeback").set({ "x-api-key": apiKey }).send({ eventId: decision.body.eventId });
    await tick();

    // Candidate: allow everything. It would have missed this fraud.
    const res = await authed(
      request(server()).post("/v1/backtest").send({
        eventType: "card.authorize",
        policy: { bands: [{ verdict: "allow", min: 0, max: 100 }] },
      }),
    );

    expect(res.status).toBe(200);
    expect(res.body.sampleSize).toBeGreaterThanOrEqual(1);
    expect(res.body.labeled).toBeGreaterThanOrEqual(1);
    expect(res.body.changed.policy).toBe(true);
    expect(res.body.baseline.truePositives).toBeGreaterThanOrEqual(1);
    expect(res.body.candidate.truePositives).toBe(0);
    expect(res.body.delta.fraudCaught).toBeLessThan(0);
  });

  it("rejects a candidate policy with gaps", async () => {
    const res = await authed(
      request(server()).post("/v1/backtest").send({
        eventType: "card.authorize",
        policy: { bands: [{ verdict: "allow", min: 0, max: 50 }] },
      }),
    );
    expect(res.status).toBe(400);
  });
});
