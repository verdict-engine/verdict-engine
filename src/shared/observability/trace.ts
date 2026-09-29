/**
 * A tiny, dependency-free distributed tracer. It speaks W3C Trace Context on the wire (so a span
 * links to the caller's trace and to downstream services) and exports OTLP/HTTP JSON to any
 * OpenTelemetry collector — without the `@opentelemetry/*` SDK, mirroring the dep-free metrics
 * registry. The current span rides an AsyncLocalStorage context, so `withSpan` nests correctly across
 * awaits without threading a span object through every call. When tracing is disabled (no OTLP
 * endpoint) every entry point is a cheap no-op, so the decision path pays nothing.
 */
import { AsyncLocalStorage } from "node:async_hooks";
import { randomBytes } from "node:crypto";
import { TRACING, type TracingConfig } from "../../config/tracing";
import { causeMessage, logEvent } from "./log";
import { traceSpansExportedTotal } from "./metrics";

export type SpanKind = "server" | "client" | "internal";
export type AttributeValue = string | number | boolean;

/** The propagated part of a span — what a child or a downstream service needs to continue the trace. */
export interface SpanContext {
  readonly traceId: string;
  readonly spanId: string;
  readonly sampled: boolean;
}

interface FinishedSpan {
  readonly traceId: string;
  readonly spanId: string;
  readonly parentSpanId?: string;
  readonly name: string;
  readonly kind: SpanKind;
  readonly startNs: bigint;
  readonly endNs: bigint;
  readonly attributes: Record<string, AttributeValue>;
  readonly status: "unset" | "ok" | "error";
  readonly statusMessage?: string;
}

export interface Span {
  readonly context: SpanContext;
  setAttribute(key: string, value: AttributeValue): void;
  recordException(cause: unknown): void;
  /** End the span. `error` marks it failed (an unended span is never exported). */
  end(error?: unknown): void;
}

const KIND_CODE: Record<SpanKind, number> = { internal: 1, server: 2, client: 3 };
const HEX16 = /^[0-9a-f]{16}$/;
const HEX32 = /^[0-9a-f]{32}$/;
const TRACEPARENT = /^00-([0-9a-f]{32})-([0-9a-f]{16})-([0-9a-f]{2})$/;

const store = new AsyncLocalStorage<SpanContext>();

function nowNs(): bigint {
  return BigInt(Date.now()) * 1_000_000n;
}

/** A no-op span handed out when tracing is off or a trace isn't sampled — zero allocation beyond this. */
class NoopSpan implements Span {
  constructor(readonly context: SpanContext) {}
  setAttribute(): void {}
  recordException(): void {}
  end(): void {}
}

/** Shared instance for the disabled path, so tracing off costs no per-span allocation. */
const NOOP_SPAN = new NoopSpan({ traceId: "0".repeat(32), spanId: "0".repeat(16), sampled: false });

class Tracer {
  private buffer: FinishedSpan[] = [];
  private timer?: ReturnType<typeof setInterval>;
  private readonly maxBatch = 512;
  private readonly flushMs = 5000;

  constructor(private readonly config: TracingConfig) {}

  get enabled(): boolean {
    return this.config.enabled;
  }

  /** Start the periodic exporter. Called once at startup; a no-op when tracing is disabled. */
  start(): void {
    if (!this.config.enabled || this.timer) return;
    this.timer = setInterval(() => void this.flush(), this.flushMs);
    this.timer.unref?.();
  }

  /** Flush and stop — called on shutdown so in-flight spans are not lost. */
  async stop(): Promise<void> {
    if (this.timer) clearInterval(this.timer);
    this.timer = undefined;
    await this.flush();
  }

  /**
   * Run `fn` inside a new span that is a child of the current context (or a new root). The span ends
   * when `fn` settles — failed if it throws. Returns whatever `fn` returns.
   */
  async withSpan<T>(
    name: string,
    fn: (span: Span) => Promise<T>,
    opts: { kind?: SpanKind; parent?: SpanContext; attributes?: Record<string, AttributeValue> } = {},
  ): Promise<T> {
    if (!this.config.enabled) return fn(NOOP_SPAN);
    const parent = opts.parent ?? store.getStore();
    const span = this.begin(name, opts.kind ?? "internal", parent, opts.attributes);
    return store.run(span.context, async () => {
      try {
        const result = await fn(span);
        span.end();
        return result;
      } catch (cause) {
        span.end(cause);
        throw cause;
      }
    });
  }

  /** Start a span whose lifetime the caller ends explicitly (used by the HTTP server middleware). */
  begin(
    name: string,
    kind: SpanKind,
    parent?: SpanContext,
    attributes: Record<string, AttributeValue> = {},
  ): Span {
    if (!this.config.enabled) return NOOP_SPAN;
    const sampled = parent ? parent.sampled : Math.random() < this.config.sampleRatio;
    const context: SpanContext = {
      traceId: parent?.traceId ?? randomBytes(16).toString("hex"),
      spanId: randomBytes(8).toString("hex"),
      sampled,
    };
    if (!sampled) return new NoopSpan(context);
    return new LiveSpan(this, context, parent?.spanId, name, kind, { ...attributes });
  }

  /** Bind `fn` to run with `context` as the current span context (server middleware wraps the request). */
  runWith<T>(context: SpanContext, fn: () => T): T {
    return store.run(context, fn);
  }

  record(span: FinishedSpan): void {
    this.buffer.push(span);
    if (this.buffer.length >= this.maxBatch) void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];
    try {
      const res = await fetch(`${this.config.endpoint}/v1/traces`, {
        method: "POST",
        headers: { "content-type": "application/json", ...this.config.headers },
        body: JSON.stringify(this.payload(batch)),
      });
      if (!res.ok) throw new Error(`collector responded ${res.status}`);
      traceSpansExportedTotal.inc({ result: "ok" }, batch.length);
    } catch (cause) {
      traceSpansExportedTotal.inc({ result: "error" }, batch.length);
      logEvent("warn", "trace.export_failed", { spans: batch.length, cause: causeMessage(cause) });
    }
  }

  /** Build the OTLP/HTTP JSON ExportTraceServiceRequest. trace/span ids are hex here, per the OTLP JSON spec. */
  private payload(spans: FinishedSpan[]): unknown {
    return {
      resourceSpans: [
        {
          resource: { attributes: [attr("service.name", this.config.serviceName)] },
          scopeSpans: [
            {
              scope: { name: "verdict-engine" },
              spans: spans.map((s) => ({
                traceId: s.traceId,
                spanId: s.spanId,
                ...(s.parentSpanId ? { parentSpanId: s.parentSpanId } : {}),
                name: s.name,
                kind: KIND_CODE[s.kind],
                startTimeUnixNano: s.startNs.toString(),
                endTimeUnixNano: s.endNs.toString(),
                attributes: Object.entries(s.attributes).map(([k, v]) => attr(k, v)),
                status: s.status === "unset" ? {} : { code: s.status === "ok" ? 1 : 2, message: s.statusMessage },
              })),
            },
          ],
        },
      ],
    };
  }
}

class LiveSpan implements Span {
  private readonly startNs = nowNs();
  private ended = false;
  private status: "unset" | "ok" | "error" = "unset";
  private statusMessage?: string;

  constructor(
    private readonly tracer: Tracer,
    readonly context: SpanContext,
    private readonly parentSpanId: string | undefined,
    private readonly name: string,
    private readonly kind: SpanKind,
    private readonly attributes: Record<string, AttributeValue>,
  ) {}

  setAttribute(key: string, value: AttributeValue): void {
    this.attributes[key] = value;
  }

  recordException(cause: unknown): void {
    this.status = "error";
    this.statusMessage = causeMessage(cause);
  }

  end(error?: unknown): void {
    if (this.ended) return;
    this.ended = true;
    if (error !== undefined) this.recordException(error);
    else if (this.status === "unset") this.status = "ok";
    this.tracer.record({
      traceId: this.context.traceId,
      spanId: this.context.spanId,
      parentSpanId: this.parentSpanId,
      name: this.name,
      kind: this.kind,
      startNs: this.startNs,
      endNs: nowNs(),
      attributes: this.attributes,
      status: this.status,
      statusMessage: this.statusMessage,
    });
  }
}

function attr(key: string, value: AttributeValue): unknown {
  const v =
    typeof value === "string"
      ? { stringValue: value }
      : typeof value === "boolean"
        ? { boolValue: value }
        : Number.isInteger(value)
          ? { intValue: String(value) }
          : { doubleValue: value };
  return { key, value: v };
}

/** Parse a W3C `traceparent` header into a parent context; undefined if absent or malformed. */
export function parseTraceparent(header: string | undefined): SpanContext | undefined {
  if (!header) return undefined;
  const m = TRACEPARENT.exec(header.trim());
  if (!m) return undefined;
  const [, traceId, spanId, flags] = m;
  if (!HEX32.test(traceId) || !HEX16.test(spanId) || traceId === "0".repeat(32) || spanId === "0".repeat(16)) {
    return undefined;
  }
  return { traceId, spanId, sampled: (Number.parseInt(flags, 16) & 1) === 1 };
}

/** Serialize a context as a `traceparent` header value, to propagate the trace to a downstream call. */
export function formatTraceparent(context: SpanContext): string {
  return `00-${context.traceId}-${context.spanId}-${context.sampled ? "01" : "00"}`;
}

export const tracer = new Tracer(TRACING);
