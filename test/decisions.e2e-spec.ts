import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { LISTS_PORT, type ListsPort } from "../src/contexts/lists/application/lists.port";

/** End-to-end: the real Nest app (in-memory adapters) driven over HTTP. */
describe("POST /v1/decisions (e2e)", () => {
  let app: INestApplication;
  let apiKey: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const lists = app.get<ListsPort>(LISTS_PORT);
    await lists.add({ kind: "block", subject: "user", value: "usr_blocked", reason: "known fraud" });

    const reg = await request(app.getHttpServer()).post("/v1/auth/register").send({ email: "admin@v.dev", password: "supersecret" });
    const created = await request(app.getHttpServer())
      .post("/v1/apikeys")
      .set({ authorization: `Bearer ${reg.body.token}` })
      .send({ name: "gateway" });
    apiKey = created.body.plaintext;
  });

  afterAll(async () => {
    await app.close();
  });

  const post = (body: object, headers: Record<string, string> = {}) =>
    request(app.getHttpServer()).post("/v1/decisions").set({ "x-api-key": apiKey, ...headers }).send(body);

  it("rejects a request without an API key", async () => {
    const res = await request(app.getHttpServer()).post("/v1/decisions").send({ type: "card.authorize", subject: { userId: "u" } });
    expect(res.status).toBe(401);
  });

  it("allows a clean low-risk card authorization", async () => {
    const res = await post({
      type: "card.authorize",
      amount: 20,
      currency: "USD",
      subject: { userId: "usr_clean", deviceId: "dev_clean", channel: "visa" },
      instrument: { kind: "card", threeDS: true },
    });
    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe("allow");
    expect(res.body.score).toBe(0);
  });

  it("returns a challenge (step-up) for a mid-risk no-3DS amount", async () => {
    const res = await post({
      type: "card.authorize",
      amount: 3500, // r_no_3ds (+22) + r_large_amount (+14) = 36
      currency: "USD",
      subject: { userId: "usr_c", deviceId: "dev_c", channel: "visa" },
      instrument: { kind: "card", threeDS: false },
    });
    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe("challenge");
  });

  it("routes an account-takeover pattern to review", async () => {
    const res = await post({
      type: "card.authorize",
      amount: 2500, // r_no_3ds (+22) + r_takeover (+33) = 55
      currency: "USD",
      subject: { userId: "usr_r", deviceId: "dev_new_r", channel: "visa" },
      instrument: { kind: "card", threeDS: false },
      attributes: { geoMismatch: true },
    });
    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe("review");
    expect(res.body.reasons.map((r: { tag: string }) => r.tag)).toContain("takeover");
  });

  it("denies a blocklisted user without scoring", async () => {
    const res = await post({
      type: "card.authorize",
      amount: 10,
      currency: "USD",
      subject: { userId: "usr_blocked", channel: "visa" },
    });
    expect(res.status).toBe(200);
    expect(res.body.verdict).toBe("deny");
    expect(res.body.reasons[0].tag).toBe("list.block");
  });

  it("is idempotent — the same key returns the same verdict id", async () => {
    const body = {
      type: "card.authorize",
      amount: 30,
      currency: "USD",
      subject: { userId: "usr_idem", deviceId: "dev_idem" },
      instrument: { kind: "card", threeDS: true },
    };
    const first = await post(body, { "idempotency-key": "idem-abc" });
    const second = await post(body, { "idempotency-key": "idem-abc" });
    expect(first.body.id).toBe(second.body.id);
  });

  it("rejects an invalid payload with 400 and a shaped error", async () => {
    const res = await post({ type: "not.a.type", subject: {} });
    expect(res.status).toBe(400);
    expect(res.body.message.code ?? res.body.code).toBeDefined();
  });
});
