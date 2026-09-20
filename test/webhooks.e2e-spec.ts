import { createServer, type Server } from "node:http";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";
import { signBody } from "../src/contexts/webhooks/domain/webhook";

describe("webhooks (e2e)", () => {
  let app: INestApplication;
  let token: string;
  let apiKey: string;
  let receiver: Server;
  let port: number;

  let received: { body: string; sig: string; event: string } | null = null;
  let resolveDelivery: () => void;
  let delivered: Promise<void>;

  beforeAll(async () => {
    delivered = new Promise((r) => (resolveDelivery = r));
    receiver = createServer((req, res) => {
      let data = "";
      req.on("data", (c) => (data += c));
      req.on("end", () => {
        received = {
          body: data,
          sig: String(req.headers["x-verdict-signature"] ?? ""),
          event: String(req.headers["x-verdict-event"] ?? ""),
        };
        res.writeHead(200);
        res.end("ok");
        resolveDelivery();
      });
    });
    await new Promise<void>((r) => receiver.listen(0, "127.0.0.1", r));
    const addr = receiver.address();
    port = typeof addr === "object" && addr ? addr.port : 0;

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
    const reg = await request(app.getHttpServer()).post("/v1/auth/register").send({ email: "risk@bank.com", password: "supersecret" });
    token = reg.body.token;
    apiKey = (await request(app.getHttpServer()).post("/v1/apikeys").set({ authorization: `Bearer ${token}` }).send({ name: "gw" })).body.plaintext;
  });

  afterAll(async () => {
    await app.close();
    await new Promise<void>((r) => receiver.close(() => r()));
  });

  const server = () => app.getHttpServer();
  const authed = (r: request.Test) => r.set("authorization", `Bearer ${token}`);

  it("guards registration to admins and validates the url", async () => {
    expect((await request(server()).post("/v1/webhooks").send({ url: "https://x/h" })).status).toBe(401);
    expect((await authed(request(server()).post("/v1/webhooks")).send({ url: "ftp://x", events: ["verdict.reached.v1"] })).status).toBe(400);
  });

  it("delivers a signed payload when a verdict is reached", async () => {
    const reg = await authed(request(server()).post("/v1/webhooks")).send({
      url: `http://127.0.0.1:${port}/hook`,
      events: ["verdict.reached.v1"],
    });
    expect(reg.status).toBe(201);
    const secret: string = reg.body.secret;
    expect(secret).toMatch(/^whsec_/);

    await request(server()).post("/v1/decisions").set({ "x-api-key": apiKey }).send({
      type: "card.authorize", amount: 100, currency: "USD",
      subject: { userId: "usr_wh", deviceId: "dev_wh", channel: "visa" },
      instrument: { kind: "card", threeDS: true },
    });

    await Promise.race([delivered, new Promise((_, rej) => setTimeout(() => rej(new Error("no delivery")), 4000))]);

    expect(received).not.toBeNull();
    expect(received?.event).toBe("verdict.reached.v1");
    const payload = JSON.parse(received?.body ?? "{}");
    expect(payload.type).toBe("verdict.reached.v1");
    expect(payload.data.verdict).toBeDefined();
    // the signature the receiver would verify
    expect(received?.sig).toBe(signBody(secret, received?.body ?? ""));
  });

  it("lists endpoints with delivery status and without the secret", async () => {
    const list = await authed(request(server()).get("/v1/webhooks"));
    expect(list.body.events).toContain("verdict.reached.v1");
    const ep = list.body.endpoints[0];
    expect(ep.secret).toBeUndefined();
    expect(ep.lastStatus).toBe("delivered");
  });
});
