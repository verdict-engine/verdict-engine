import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("rules CMS (e2e)", () => {
  let app: INestApplication;
  let token: string;
  let apiKey: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const reg = await request(app.getHttpServer()).post("/v1/auth/register").send({ email: "risk@bank.com", password: "supersecret" });
    token = reg.body.token;
    apiKey = (await request(app.getHttpServer()).post("/v1/apikeys").set({ authorization: `Bearer ${token}` }).send({ name: "gw" })).body.plaintext;
  });

  afterAll(async () => { await app.close(); });

  const server = () => app.getHttpServer();
  const authed = (r: request.Test) => r.set("authorization", `Bearer ${token}`);
  const decide = () =>
    request(server()).post("/v1/decisions").set({ "x-api-key": apiKey }).send({
      type: "card.authorize", amount: 120, currency: "USD",
      subject: { userId: "usr_cms", deviceId: "dev_cms", channel: "visa" },
      instrument: { kind: "card", threeDS: true },
    });

  it("exposes the seed ruleset with structured conditions", async () => {
    const res = await authed(request(server()).get("/v1/rules"));
    const card = res.body.find((r: { eventType: string }) => r.eventType === "card.authorize");
    expect(card.version).toBe("seed@v0.4");
    expect(card.rules[0].condition).toBeDefined();
    expect(card.rules[0].dsl).toContain("rule ");
  });

  it("guards publishing and rejects an invalid ruleset", async () => {
    expect((await request(server()).post("/v1/rules").send({ eventType: "card.authorize", version: "x", rules: [] })).status).toBe(401);
    const bad = await authed(request(server()).post("/v1/rules")).send({
      eventType: "card.authorize", version: "bad.1",
      rules: [{ id: "r_x", tag: "x", weight: 10, condition: { kind: "compare", path: "nope.field", op: "gt", value: 1 } }],
    });
    expect(bad.status).toBe(400);
  });

  it("a published rule change takes effect on the next decision, and rolls back", async () => {
    expect((await decide()).body.verdict).toBe("allow"); // baseline: small clean amount

    const publish = await authed(request(server()).post("/v1/rules")).send({
      eventType: "card.authorize",
      version: "block.1",
      rules: [{ id: "r_block_all", tag: "blocked", weight: 100, condition: { kind: "compare", path: "event.amount", op: "gt", value: -1 } }],
    });
    expect(publish.status).toBe(201);
    expect((await decide()).body.verdict).toBe("deny"); // the new always-on rule scores 100

    const history = await authed(request(server()).get("/v1/rules/card.authorize/history"));
    expect(history.body).toEqual(expect.arrayContaining(["seed@v0.4", "block.1"]));

    const rollback = await authed(request(server()).post("/v1/rules/card.authorize/rollback")).send({ toVersion: "seed@v0.4" });
    expect(rollback.status).toBe(201);
    expect((await decide()).body.verdict).toBe("allow"); // back to baseline
  });
});
