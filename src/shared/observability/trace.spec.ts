import { afterEach, describe, expect, it, vi } from "vitest";
import { formatTraceparent, parseTraceparent } from "./trace";

describe("W3C traceparent", () => {
  it("round-trips a sampled context", () => {
    const header = "00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-01";
    const ctx = parseTraceparent(header);
    expect(ctx).toEqual({
      traceId: "0af7651916cd43dd8448eb211c80319c",
      spanId: "b7ad6b7169203331",
      sampled: true,
    });
    expect(formatTraceparent(ctx!)).toBe(header);
  });

  it("reads the un-sampled flag", () => {
    expect(parseTraceparent("00-0af7651916cd43dd8448eb211c80319c-b7ad6b7169203331-00")?.sampled).toBe(false);
  });

  it("rejects malformed, all-zero, or absent headers", () => {
    expect(parseTraceparent(undefined)).toBeUndefined();
    expect(parseTraceparent("garbage")).toBeUndefined();
    expect(parseTraceparent("00-xyz-b7ad6b7169203331-01")).toBeUndefined();
    // all-zero trace id / span id are invalid per the spec
    expect(parseTraceparent("00-00000000000000000000000000000000-b7ad6b7169203331-01")).toBeUndefined();
    expect(parseTraceparent("00-0af7651916cd43dd8448eb211c80319c-0000000000000000-01")).toBeUndefined();
  });
});

describe("tracer (module singleton, tracing disabled by default in tests)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("runs the body and never exports when disabled", async () => {
    const { tracer } = await import("./trace");
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const result = await tracer.withSpan("noop", async (span) => {
      span.setAttribute("k", "v");
      return 41 + 1;
    });
    expect(result).toBe(42);
    await tracer.stop();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("propagates the thrown error out of withSpan", async () => {
    const { tracer } = await import("./trace");
    await expect(tracer.withSpan("boom", async () => Promise.reject(new Error("nope")))).rejects.toThrow("nope");
  });
});

describe("OTLP export (enabled tracer)", () => {
  afterEach(() => vi.restoreAllMocks());

  it("posts an OTLP/HTTP JSON payload with hex ids and nested spans", async () => {
    vi.resetModules();
    vi.stubEnv("OTEL_EXPORTER_OTLP_ENDPOINT", "http://collector:4318");
    vi.stubEnv("TRACE_SAMPLE_RATIO", "1");
    const captured: { url: string; body: unknown } = { url: "", body: undefined };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string, init: { body: string }) => {
        captured.url = url;
        captured.body = JSON.parse(init.body);
        return { ok: true, status: 200 } as Response;
      }),
    );

    const { tracer } = await import("./trace");
    await tracer.withSpan("parent", async () => {
      await tracer.withSpan("child", async () => undefined);
    });
    await tracer.stop();

    expect(captured.url).toBe("http://collector:4318/v1/traces");
    const body = captured.body as {
      resourceSpans: Array<{
        resource: { attributes: Array<{ key: string; value: { stringValue?: string } }> };
        scopeSpans: Array<{ spans: Array<{ name: string; traceId: string; spanId: string; parentSpanId?: string }> }>;
      }>;
    };
    const spans = body.resourceSpans[0].scopeSpans[0].spans;
    expect(spans.map((s) => s.name).sort()).toEqual(["child", "parent"]);
    const parent = spans.find((s) => s.name === "parent")!;
    const child = spans.find((s) => s.name === "child")!;
    // Child nests under parent and shares the trace id (a single distributed trace).
    expect(child.traceId).toBe(parent.traceId);
    expect(child.parentSpanId).toBe(parent.spanId);
    expect(parent.traceId).toMatch(/^[0-9a-f]{32}$/);
    expect(parent.spanId).toMatch(/^[0-9a-f]{16}$/);
    expect(body.resourceSpans[0].resource.attributes[0]).toEqual({
      key: "service.name",
      value: { stringValue: "verdict-engine" },
    });

    vi.unstubAllEnvs();
    vi.resetModules();
  });
});
