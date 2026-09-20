import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("api keys (e2e)", () => {
  let app: INestApplication;
  let adminToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const reg = await request(app.getHttpServer()).post("/v1/auth/register").send({ email: "admin@v.dev", password: "supersecret" });
    adminToken = reg.body.token;
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const asAdmin = (r: request.Test) => r.set({ authorization: `Bearer ${adminToken}` });
  const decision = { type: "card.authorize", amount: 20, currency: "USD", subject: { userId: "u" }, instrument: { kind: "card", threeDS: true } };

  it("only an admin can create keys, and the plaintext is shown once", async () => {
    const analyst = await asAdmin(request(server()).post("/v1/auth/users").send({ email: "ana@v.dev", password: "supersecret" }));
    const login = await request(server()).post("/v1/auth/login").send({ email: "ana@v.dev", password: "supersecret" });
    expect(analyst.status).toBe(201);

    const denied = await request(server()).post("/v1/apikeys").set({ authorization: `Bearer ${login.body.token}` }).send({ name: "x" });
    expect(denied.status).toBe(403);

    const created = await asAdmin(request(server()).post("/v1/apikeys").send({ name: "payment-gateway" }));
    expect(created.status).toBe(201);
    expect(created.body.plaintext).toMatch(/^vk_live_/);
    expect(created.body.key.prefix).toBe(created.body.plaintext.slice(0, 16));
  });

  it("guards /v1/decisions with the key, and a revoked key stops working", async () => {
    expect((await request(server()).post("/v1/decisions").send(decision)).status).toBe(401);

    const created = await asAdmin(request(server()).post("/v1/apikeys").send({ name: "gateway" }));
    const key: string = created.body.plaintext;
    const id: string = created.body.key.id;

    const ok = await request(server()).post("/v1/decisions").set({ "x-api-key": key }).send(decision);
    expect(ok.status).toBe(200);

    const list = await asAdmin(request(server()).get("/v1/apikeys"));
    expect(list.body.some((k: { id: string }) => k.id === id)).toBe(true);

    expect((await asAdmin(request(server()).post(`/v1/apikeys/${id}/revoke`))).status).toBe(200);
    const afterRevoke = await request(server()).post("/v1/decisions").set({ "x-api-key": key }).send(decision);
    expect(afterRevoke.status).toBe(401);
  });
});
