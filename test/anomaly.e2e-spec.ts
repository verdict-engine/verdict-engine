import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("anomaly detection (e2e)", () => {
  let app: INestApplication;
  let apiKey: string;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();

    const reg = await request(app.getHttpServer())
      .post("/v1/auth/register")
      .send({ email: "risk@bank.com", password: "supersecret" });

    const key = await request(app.getHttpServer())
      .post("/v1/apikeys")
      .set({ authorization: `Bearer ${reg.body.token}` })
      .send({ name: "gateway" });
    apiKey = key.body.plaintext;
  });

  afterAll(async () => {
    await app.close();
  });

  const decide = (userId: string, amount: number) =>
    request(app.getHttpServer())
      .post("/v1/decisions")
      .set({ "x-api-key": apiKey })
      .send({
        type: "card.authorize",
        amount,
        currency: "USD",
        subject: { userId, deviceId: `dev_${userId}`, channel: "visa" },
        instrument: { kind: "card", threeDS: true },
        attributes: {},
      });

  const hasSpike = (res: { body: { reasons: Array<{ tag: string }> } }) =>
    res.body.reasons.some((r) => r.tag === "amount_spike");

  it("does not flag amounts in line with the user's own history", async () => {
    for (const amount of [100, 120, 110, 130]) await decide("usr_spend", amount);
    expect(hasSpike(await decide("usr_spend", 118))).toBe(false);
  });

  it("flags an amount far outside the user's baseline", async () => {
    expect(hasSpike(await decide("usr_spend", 6000))).toBe(true);
  });

  it("does not flag a user with no baseline yet", async () => {
    expect(hasSpike(await decide("usr_fresh", 6000))).toBe(false);
  });
});
