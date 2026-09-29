import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

/**
 * Proves tenant isolation end-to-end: two orgs, each with its own API key, make decisions, and neither
 * can see the other's verdicts or keys. The store scopes by the request's org (set from the
 * authenticated principal/key), so the boundary is enforced centrally, not per endpoint.
 */
describe("multi-tenancy isolation (e2e)", () => {
  let app: INestApplication;
  const server = () => app.getHttpServer();

  let rootToken: string;
  let rootKey: string;
  let org2Token: string;
  let org2Key: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    // First registration bootstraps the root admin in the 'default' org.
    const root = await request(server()).post("/v1/auth/register").send({ email: "root@v.dev", password: "supersecret1" });
    rootToken = root.body.token;
    rootKey = (
      await request(server()).post("/v1/apikeys").set({ authorization: `Bearer ${rootToken}` }).send({ name: "root" })
    ).body.plaintext;

    // Root provisions a second tenant with its own admin, who logs in and mints a key.
    const provision = await request(server())
      .post("/v1/orgs")
      .set({ authorization: `Bearer ${rootToken}` })
      .send({ name: "Acme", adminEmail: "admin@acme.dev", adminPassword: "supersecret2" });
    expect(provision.status).toBe(201);
    expect(provision.body.org.name).toBe("Acme");

    const login = await request(server()).post("/v1/auth/login").send({ email: "admin@acme.dev", password: "supersecret2" });
    org2Token = login.body.token;
    org2Key = (
      await request(server()).post("/v1/apikeys").set({ authorization: `Bearer ${org2Token}` }).send({ name: "acme" })
    ).body.plaintext;
  });

  afterAll(async () => {
    await app.close();
  });

  const decide = (key: string, userId: string) =>
    request(server())
      .post("/v1/decisions")
      .set({ "x-api-key": key })
      .send({ type: "card.authorize", amount: 50, currency: "USD", subject: { userId } });

  const verdicts = (token: string) =>
    request(server()).get("/v1/verdicts?limit=100").set({ authorization: `Bearer ${token}` });

  it("provisioning fails for a non-root tenant admin", async () => {
    const denied = await request(server())
      .post("/v1/orgs")
      .set({ authorization: `Bearer ${org2Token}` })
      .send({ name: "Sneaky", adminEmail: "x@y.dev", adminPassword: "supersecret3" });
    expect(denied.status).toBe(403);
  });

  it("keeps each org's verdicts private to that org", async () => {
    expect((await decide(rootKey, "root-user")).status).toBe(200);
    expect((await decide(org2Key, "acme-user-1")).status).toBe(200);
    expect((await decide(org2Key, "acme-user-2")).status).toBe(200);

    const rootVerdicts = (await verdicts(rootToken)).body as Array<{ eventId: string }>;
    const org2Verdicts = (await verdicts(org2Token)).body as Array<{ eventId: string }>;

    // Each org sees only its own decisions — no overlap, and its own count.
    expect(rootVerdicts).toHaveLength(1);
    expect(org2Verdicts).toHaveLength(2);
    const rootIds = new Set(rootVerdicts.map((v) => v.eventId));
    const org2Ids = new Set(org2Verdicts.map((v) => v.eventId));
    for (const id of org2Ids) expect(rootIds.has(id)).toBe(false);
  });

  it("keeps each org's API keys private to that org", async () => {
    const rootKeys = (await request(server()).get("/v1/apikeys").set({ authorization: `Bearer ${rootToken}` })).body as Array<{ name: string }>;
    const org2Keys = (await request(server()).get("/v1/apikeys").set({ authorization: `Bearer ${org2Token}` })).body as Array<{ name: string }>;
    expect(rootKeys.map((k) => k.name)).toEqual(["root"]);
    expect(org2Keys.map((k) => k.name)).toEqual(["acme"]);
  });

  it("keeps each org's operator list private to that org", async () => {
    const rootUsers = (await request(server()).get("/v1/auth/users").set({ authorization: `Bearer ${rootToken}` })).body as Array<{ email: string }>;
    const org2Users = (await request(server()).get("/v1/auth/users").set({ authorization: `Bearer ${org2Token}` })).body as Array<{ email: string }>;
    expect(rootUsers.map((u) => u.email)).toEqual(["root@v.dev"]);
    expect(org2Users.map((u) => u.email)).toEqual(["admin@acme.dev"]);
  });
});
