import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("hardening: rate limiting + erasure (e2e)", () => {
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

  it("guards erasure and requires a userId", async () => {
    expect((await request(server()).post("/v1/privacy/erase").send({ userId: "u" })).status).toBe(401);
    expect((await authed(request(server()).post("/v1/privacy/erase")).send({})).status).toBe(400);
  });

  it("erases a user's graph identity, baseline and replay samples", async () => {
    await request(server())
      .post("/v1/decisions")
      .set({ "x-api-key": apiKey })
      .send({
        type: "card.authorize",
        amount: 250,
        currency: "USD",
        subject: { userId: "usr_erase", deviceId: "dev_erase", channel: "visa" },
        instrument: { kind: "card", threeDS: true },
        attributes: {},
      });

    const before = await authed(request(server()).get("/v1/graph/user/usr_erase"));
    expect(before.body.devices).toContain("dev_erase");

    const erased = await authed(request(server()).post("/v1/privacy/erase").send({ userId: "usr_erase" }));
    expect(erased.status).toBe(200);
    expect(erased.body.replaySamplesRemoved).toBeGreaterThanOrEqual(1);

    const after = await authed(request(server()).get("/v1/graph/user/usr_erase"));
    expect(after.body.devices).toHaveLength(0);
    expect(after.body.ringSize).toBe(1);
  });

  it("rate-limits repeated login attempts with a 429", async () => {
    let sawLimit = false;
    for (let i = 0; i < 15; i++) {
      const res = await request(server()).post("/v1/auth/login").send({ email: "risk@bank.com", password: "wrong" });
      if (res.status === 429) {
        sawLimit = true;
        expect(res.headers["retry-after"]).toBeDefined();
        break;
      }
      expect(res.status).toBe(401); // allowed but wrong creds
    }
    expect(sawLimit).toBe(true);
  });
});
