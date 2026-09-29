import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { INestApplication } from "@nestjs/common";
import request from "supertest";

/**
 * End-to-end proof that a request's server span, opened by the Express middleware, is the active
 * AsyncLocalStorage context all the way into the decision service — so the decision spans nest under
 * it in one trace — and that the batch is exported as OTLP/HTTP JSON. Tracing is a module singleton
 * fixed at import, so env is stubbed and the modules imported fresh before the app is built.
 */
interface OtlpSpan {
  readonly name: string;
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
}

describe("distributed tracing (e2e)", () => {
  let app: INestApplication;
  const captured: OtlpSpan[] = [];
  let stopTracer: () => Promise<void>;

  beforeAll(async () => {
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector.test:4318");
    vi.stubEnv("TRACE_SAMPLE_RATIO", "1");
    vi.stubEnv("PERSISTENCE", "memory");
    vi.stubGlobal(
      "fetch",
      vi.fn(async (_url: string, init: { body: string }) => {
        const payload = JSON.parse(init.body) as {
          resourceSpans: Array<{ scopeSpans: Array<{ spans: OtlpSpan[] }> }>;
        };
        for (const rs of payload.resourceSpans) for (const ss of rs.scopeSpans) captured.push(...ss.spans);
        return { ok: true, status: 200 } as Response;
      }),
    );
    vi.resetModules();

    const { Test } = await import("@nestjs/testing");
    const { AppModule } = await import("../src/app.module");
    const { tracer } = await import("../src/shared/observability/trace");
    const { tracingMiddleware } = await import("../src/shared/observability/trace-http");
    stopTracer = () => tracer.stop();

    const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
    app = moduleRef.createNestApplication();
    app.use(tracingMiddleware);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
    vi.resetModules();
  });

  it("emits one trace whose decision spans nest under the HTTP server span", async () => {
    const server = app.getHttpServer();
    const reg = await request(server).post("/v1/auth/register").send({ email: "trace@v.dev", password: "supersecret" });
    const key = await request(server)
      .post("/v1/apikeys")
      .set({ authorization: `Bearer ${reg.body.token}` })
      .send({ name: "tracing" });
    const decision = await request(server)
      .post("/v1/decisions")
      .set({ "x-api-key": key.body.plaintext })
      .send({ type: "card.authorize", amount: 50, currency: "USD", subject: { userId: "u1" }, attributes: {} });
    expect(decision.status).toBe(200);
    // The response carries the trace id so an operator can correlate the request with its trace.
    expect(decision.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);

    await stopTracer(); // flush the batch

    const byName = (n: string) => captured.filter((s) => s.name === n);
    const server_ = byName("POST /v1/decisions");
    const decide = byName("decision.decide");
    expect(server_).toHaveLength(1);
    expect(decide).toHaveLength(1);

    // The decision span shares the request's trace and chains up to the server span.
    expect(decide[0].traceId).toBe(server_[0].traceId);
    const byId = new Map(captured.filter((s) => s.traceId === server_[0].traceId).map((s) => [s.spanId, s]));
    const climb = (from: OtlpSpan): OtlpSpan => {
      let cur = from;
      while (cur.parentSpanId && byId.has(cur.parentSpanId)) cur = byId.get(cur.parentSpanId)!;
      return cur;
    };
    expect(climb(decide[0]).spanId).toBe(server_[0].spanId);

    // The scoring sub-steps are recorded too, in the same trace.
    for (const step of ["feature-store.snapshot", "rules.evaluate", "scorer.score", "decision.commit"]) {
      const spans = byName(step);
      expect(spans.length, step).toBeGreaterThanOrEqual(1);
      expect(spans[0].traceId).toBe(server_[0].traceId);
    }
  });
});
