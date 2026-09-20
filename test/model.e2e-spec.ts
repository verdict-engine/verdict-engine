import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

const tick = () => new Promise((r) => setTimeout(r, 25));

describe("adaptive model (e2e)", () => {
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

  it("guards the model view", async () => {
    expect((await request(server()).get("/v1/model")).status).toBe(401);
  });

  it("learns tag weights from a resolved case", async () => {
    const decision = await request(server())
      .post("/v1/decisions")
      .set({ "x-api-key": apiKey })
      .send({
        type: "card.authorize",
        amount: 2500,
        currency: "USD",
        subject: { userId: "usr_learn", deviceId: "dev_learn", channel: "visa" },
        instrument: { kind: "card", threeDS: false },
        attributes: { geoMismatch: true },
      });
    expect(decision.body.verdict).toBe("review");
    expect(decision.body.reasons.length).toBeGreaterThan(0);
    const firedTag = decision.body.reasons[0].tag;
    await tick();

    const queue = await authed(request(server()).get("/v1/cases").query({ queue: "risk-ops" }));
    const opened = queue.body.find((c: { eventId: string }) => c.eventId === decision.body.eventId);
    await authed(request(server()).post(`/v1/cases/${opened.id}/resolve`).send({ outcome: "fraud" }));
    await tick();

    const model = await authed(request(server()).get("/v1/model"));
    expect(model.status).toBe(200);
    expect(model.body.active).toBe("weighted");
    const credited = model.body.weights.find((w: { tag: string }) => w.tag === firedTag);
    expect(credited).toBeDefined();
    expect(credited.fraud).toBe(1);
  });

  const fraudFor = async (tag: string): Promise<number> => {
    const model = await authed(request(server()).get("/v1/model"));
    return model.body.weights.find((w: { tag: string }) => w.tag === tag)?.fraud ?? 0;
  };

  it("learns from a chargeback on an event that was never a case", async () => {
    const decision = await request(server())
      .post("/v1/decisions")
      .set({ "x-api-key": apiKey })
      .send({
        type: "card.authorize",
        amount: 900,
        currency: "USD",
        subject: { userId: "usr_cb", deviceId: "dev_cb", channel: "visa" },
        instrument: { kind: "card", threeDS: false },
        attributes: { geoMismatch: true },
      });
    const firedTag = decision.body.reasons[0].tag;
    await tick();
    const before = await fraudFor(firedTag);

    const cb = await request(server())
      .post("/v1/labels/chargeback")
      .set({ "x-api-key": apiKey })
      .send({ eventId: decision.body.eventId });
    expect(cb.status).toBe(202);
    await tick();

    expect(await fraudFor(firedTag)).toBe(before + 1);
  });
});
