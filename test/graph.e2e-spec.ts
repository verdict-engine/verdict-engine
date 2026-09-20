import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("entity graph (e2e)", () => {
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

  const decide = (userId: string, deviceId: string) =>
    request(server())
      .post("/v1/decisions")
      .set({ "x-api-key": apiKey })
      .send({
        type: "card.authorize",
        amount: 100,
        currency: "USD",
        subject: { userId, deviceId, channel: "visa" },
        instrument: { kind: "card", threeDS: true },
        attributes: {},
      });

  it("guards the graph endpoint", async () => {
    expect((await request(server()).get("/v1/graph/device/dev_ring")).status).toBe(401);
  });

  it("links entities that share a device into one cluster", async () => {
    for (let i = 1; i <= 7; i++) await decide(`usr_${i}`, "dev_ring");

    const res = await authed(request(server()).get("/v1/graph/device/dev_ring"));
    expect(res.status).toBe(200);
    expect(res.body.users).toHaveLength(7);
    expect(res.body.ringSize).toBe(8); // the device + 7 users
  });

  it("fires the ring rule for a user inside a large cluster", async () => {
    const res = await decide("usr_1", "dev_ring");
    expect(res.body.reasons.some((r: { tag: string }) => r.tag === "ring")).toBe(true);
  });

  it("reports no ring for an unconnected entity", async () => {
    const res = await authed(request(server()).get("/v1/graph/user/usr_lonely"));
    expect(res.body.ringSize).toBe(1);
    expect(res.body.devices).toHaveLength(0);
  });

  it("links accounts that share a phone (MSISDN) and flags a SIM box", async () => {
    const pay = (userId: string) =>
      request(server()).post("/v1/decisions").set({ "x-api-key": apiKey }).send({
        type: "payment.authorize", amount: 100, currency: "USD",
        subject: { userId, deviceId: `dev_${userId}`, phone: "+251900000001", channel: "telebirr" },
        instrument: { kind: "wallet" },
      });
    for (let i = 1; i <= 4; i++) await pay(`msi_${i}`);

    const nbr = await authed(request(server()).get(`/v1/graph/phone/${encodeURIComponent("+251900000001")}`));
    expect(nbr.status).toBe(200);
    expect(nbr.body.users).toHaveLength(4);

    const fifth = await pay("msi_5"); // usersOnPhone is now 4 (>3) → sim_box fires
    expect(fifth.body.reasons.some((r: { tag: string }) => r.tag === "sim_box")).toBe(true);
  });
});
