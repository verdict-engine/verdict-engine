/**
 * Distributed-tracing configuration, read once at startup. Tracing is off unless an OTLP endpoint is
 * configured (or explicitly forced), so the default deployment pays nothing. When on, the engine emits
 * W3C trace-context spans and ships them to any OpenTelemetry-compatible collector over OTLP/HTTP —
 * without pulling in the `@opentelemetry/*` SDK, matching the dependency-free metrics registry.
 */
export interface TracingConfig {
  readonly enabled: boolean;
  readonly serviceName: string;
  /** Base OTLP/HTTP endpoint, e.g. `http://collector:4318`; spans POST to `${endpoint}/v1/traces`. */
  readonly endpoint: string;
  /** Head sampling ratio in [0,1] for root spans; a sampled parent is always followed. */
  readonly sampleRatio: number;
  /** Extra headers for the collector (auth for a hosted OTLP endpoint), parsed from OTEL_EXPORTER_OTLP_HEADERS. */
  readonly headers: Readonly<Record<string, string>>;
}

function ratio(raw: string | undefined, fallback: number): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 && n <= 1 ? n : fallback;
}

/** Parse `k1=v1,k2=v2` (the OTEL_EXPORTER_OTLP_HEADERS convention) into a header map. */
function parseHeaders(raw: string | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const pair of (raw ?? "").split(",")) {
    const eq = pair.indexOf("=");
    if (eq <= 0) continue;
    const key = pair.slice(0, eq).trim();
    const value = pair.slice(eq + 1).trim();
    if (key) out[key] = value;
  }
  return out;
}

export function loadTracingConfig(env: NodeJS.ProcessEnv = process.env): TracingConfig {
  const endpoint = (env.OTEL_EXPORTER_OTLP_ENDPOINT ?? "").replace(/\/+$/, "");
  // Enabled when an endpoint is set, unless TRACING_ENABLED explicitly overrides either way.
  const flag = env.TRACING_ENABLED;
  const enabled = flag === "true" || (flag !== "false" && endpoint.length > 0);
  return {
    enabled: enabled && endpoint.length > 0,
    serviceName: env.OTEL_SERVICE_NAME ?? "verdict-engine",
    endpoint,
    sampleRatio: ratio(env.TRACE_SAMPLE_RATIO, 1),
    headers: parseHeaders(env.OTEL_EXPORTER_OTLP_HEADERS),
  };
}

export const TRACING = loadTracingConfig();
