import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { INestApplication } from "@nestjs/common";
import { Test } from "@nestjs/testing";
import request from "supertest";
import { AppModule } from "../src/app.module";

describe("health & readiness (e2e)", () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it("liveness /health reports ok and the version", async () => {
    const res = await request(app.getHttpServer()).get("/health");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ok");
    expect(res.body.version).toBeTruthy();
  });

  it("readiness /readyz reports ready when the store is reachable", async () => {
    const res = await request(app.getHttpServer()).get("/readyz");
    expect(res.status).toBe(200);
    expect(res.body.status).toBe("ready");
    expect(res.body.checks.store).toBe("ok");
    // Redis is not configured in tests, so it is skipped rather than failing readiness.
    expect(res.body.checks.redis).toBe("skipped");
  });

  it("serves /metrics publicly when METRICS_TOKEN is unset", async () => {
    const prev = process.env.METRICS_TOKEN;
    delete process.env.METRICS_TOKEN;
    try {
      await request(app.getHttpServer()).get("/metrics").expect(200);
    } finally {
      if (prev !== undefined) process.env.METRICS_TOKEN = prev;
    }
  });

  it("gates /metrics behind the token when METRICS_TOKEN is set", async () => {
    const prev = process.env.METRICS_TOKEN;
    process.env.METRICS_TOKEN = "m3trics-secret";
    try {
      const server = app.getHttpServer();
      await request(server).get("/metrics").expect(401);
      await request(server).get("/metrics").set("authorization", "Bearer wrong").expect(401);
      await request(server).get("/metrics").set("authorization", "Bearer m3trics-secret").expect(200);
      await request(server).get("/metrics").set("x-metrics-token", "m3trics-secret").expect(200);
    } finally {
      if (prev === undefined) delete process.env.METRICS_TOKEN;
      else process.env.METRICS_TOKEN = prev;
    }
  });
});
