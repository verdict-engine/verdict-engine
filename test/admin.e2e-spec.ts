import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("admin & config (e2e)", () => {
  let app: INestApplication;
  let adminToken: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  const server = () => app.getHttpServer();
  const bearer = (t: string) => (r: request.Test) => r.set("authorization", `Bearer ${t}`);

  it("bootstraps the first user as admin, then closes registration", async () => {
    const status = await request(server()).get("/v1/auth/status");
    expect(status.body.needsBootstrap).toBe(true);

    const admin = await request(server()).post("/v1/auth/register").send({ email: "admin@v.dev", password: "supersecret" });
    expect(admin.status).toBe(201);
    expect(admin.body.user.role).toBe("admin");
    adminToken = admin.body.token;

    expect((await request(server()).get("/v1/auth/status")).body.needsBootstrap).toBe(false);

    const second = await request(server()).post("/v1/auth/register").send({ email: "sneaky@v.dev", password: "supersecret" });
    expect(second.status).toBe(403);
    expect(second.body.code).toBe("REGISTRATION_CLOSED");
  });

  it("lets an admin create an analyst, but an analyst cannot create users", async () => {
    const created = await bearer(adminToken)(
      request(server()).post("/v1/auth/users").send({ email: "ana@v.dev", password: "supersecret" }),
    );
    expect(created.status).toBe(201);
    expect(created.body.role).toBe("analyst");

    const analyst = await request(server()).post("/v1/auth/login").send({ email: "ana@v.dev", password: "supersecret" });
    const denied = await bearer(analyst.body.token)(
      request(server()).post("/v1/auth/users").send({ email: "x@v.dev", password: "supersecret" }),
    );
    expect(denied.status).toBe(403);

    const users = await bearer(adminToken)(request(server()).get("/v1/auth/users"));
    expect(users.body.map((u: { email: string }) => u.email).sort()).toEqual(["admin@v.dev", "ana@v.dev"]);
  });

  it("lets an admin publish a new policy version and roll it back", async () => {
    const policies = await bearer(adminToken)(request(server()).get("/v1/policies"));
    const card = policies.body.find((p: { eventType: string }) => p.eventType === "card.authorize");
    const id = card.policy.id;

    const publish = await bearer(adminToken)(
      request(server()).post("/v1/policies").send({
        id,
        version: "v0.4.1",
        onError: "fail_closed",
        bands: [
          { verdict: "allow", min: 0, max: 20 },
          { verdict: "challenge", min: 21, max: 44 },
          { verdict: "review", min: 45, max: 69, reviewQueue: "risk-ops" },
          { verdict: "deny", min: 70, max: 100 },
        ],
      }),
    );
    expect(publish.status).toBe(201);

    const after = await bearer(adminToken)(request(server()).get("/v1/policies"));
    expect(after.body.find((p: { eventType: string }) => p.eventType === "card.authorize").policy.version).toBe("v0.4.1");

    const history = await bearer(adminToken)(request(server()).get(`/v1/policies/${id}/history`));
    expect(history.body).toContain("v0.4.0");

    const rolled = await bearer(adminToken)(
      request(server()).post(`/v1/policies/${id}/rollback`).send({ toVersion: "v0.4.0" }),
    );
    expect(rolled.status).toBe(201);

    const restored = await bearer(adminToken)(request(server()).get("/v1/policies"));
    expect(restored.body.find((p: { eventType: string }) => p.eventType === "card.authorize").policy.version).toBe("v0.4.0");
  });

  it("rejects an invalid policy", async () => {
    const bad = await bearer(adminToken)(
      request(server()).post("/v1/policies").send({
        id: "pol_card_authorize",
        version: "v0.9",
        onError: "fail_open",
        bands: [{ verdict: "allow", min: 0, max: 50 }],
      }),
    );
    expect(bad.status).toBe(400);
  });
});
