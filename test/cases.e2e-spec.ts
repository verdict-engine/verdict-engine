import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

const tick = () => new Promise((r) => setTimeout(r, 25));

describe("case lifecycle (e2e)", () => {
  let app: INestApplication;
  let token: string;
  let apiKey: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const reg = await request(app.getHttpServer())
      .post("/v1/auth/register")
      .send({ email: "maya@bank.com", password: "supersecret" });
    expect(reg.status).toBe(201);
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

  it("rejects the cases API without a token", async () => {
    const res = await request(server()).get("/v1/cases");
    expect(res.status).toBe(401);
  });

  it("opens a case from a review verdict, then assigns and resolves it", async () => {
    const decision = await request(server())
      .post("/v1/decisions")
      .set({ "x-api-key": apiKey })
      .send({
        type: "card.authorize",
        amount: 2500,
        currency: "USD",
        subject: { userId: "usr_case", deviceId: "dev_case", channel: "visa" },
        instrument: { kind: "card", threeDS: false },
        attributes: { geoMismatch: true },
      });
    expect(decision.body.verdict).toBe("review");

    await tick();

    const queue = await authed(request(server()).get("/v1/cases").query({ queue: "risk-ops" }));
    expect(queue.status).toBe(200);
    const opened = queue.body.find((c: { eventId: string }) => c.eventId === decision.body.eventId);
    expect(opened).toBeDefined();

    const assigned = await authed(request(server()).post(`/v1/cases/${opened.id}/assign`));
    expect(assigned.body.status).toBe("assigned");
    expect(assigned.body.assignedTo).toBe("maya@bank.com"); // analyst from the token, not the body

    const resolved = await authed(
      request(server()).post(`/v1/cases/${opened.id}/resolve`).send({ outcome: "fraud", note: "confirmed ATO" }),
    );
    expect(resolved.body.status).toBe("resolved");
    expect(resolved.body.resolution.analyst).toBe("maya@bank.com");
    expect(resolved.body.audit).toHaveLength(3);
  });

  it("rejects resolving an already-resolved case with 409", async () => {
    const queue = await authed(request(server()).get("/v1/cases").query({ queue: "risk-ops" }));
    const resolvedCase = queue.body.find((c: { status: string }) => c.status === "resolved");
    const res = await authed(request(server()).post(`/v1/cases/${resolvedCase.id}/resolve`).send({ outcome: "legit" }));
    expect(res.status).toBe(409);
  });

  it("accepts a chargeback label (system endpoint, no operator auth)", async () => {
    const res = await request(server()).post("/v1/labels/chargeback").set({ "x-api-key": apiKey }).send({ eventId: "evt_somepast" });
    expect(res.status).toBe(202);
  });

  it("exposes the live rules, policies and verdicts (guarded)", async () => {
    expect((await request(server()).get("/v1/rules")).status).toBe(401);

    const rules = await authed(request(server()).get("/v1/rules"));
    expect(rules.status).toBe(200);
    const card = rules.body.find((r: { eventType: string }) => r.eventType === "card.authorize");
    expect(card.rules[0].dsl).toContain("rule ");

    const policies = await authed(request(server()).get("/v1/policies"));
    expect(policies.body.some((p: { eventType: string }) => p.eventType === "card.authorize")).toBe(true);

    const verdicts = await authed(request(server()).get("/v1/verdicts").query({ limit: 5 }));
    expect(Array.isArray(verdicts.body)).toBe(true);
  });

  it("serves health without auth", async () => {
    const res = await request(server()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
  });

  it("simulates a score against the live policy", async () => {
    const policies = await authed(request(server()).get("/v1/policies"));
    const id = policies.body.find((p: { eventType: string }) => p.eventType === "card.authorize").policy.id;
    const sim = await authed(request(server()).post(`/v1/policies/${id}/simulate`).send({ score: 61 }));
    expect(sim.body.verdict).toBe("review");
  });

  it("projects analytics from the decisions it has seen", async () => {
    const res = await authed(request(server()).get("/v1/analytics/summary"));
    expect(res.status).toBe(200);
    expect(res.body.totals.decisions).toBeGreaterThan(0);
    expect(typeof res.body.falsePositiveRate).toBe("number");
  });
});
