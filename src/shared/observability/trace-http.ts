/**
 * Express middleware that opens a SERVER span per HTTP request and makes it the active context for
 * the whole handler (via the tracer's AsyncLocalStorage), so spans started deeper in the decision
 * path nest under it. The incoming W3C `traceparent` is honoured, so the engine's trace links to the
 * caller's. Health/metrics/docs traffic is skipped to keep traces about real work. A no-op passthrough
 * when tracing is disabled.
 */
import { formatTraceparent, parseTraceparent, tracer } from "./trace";

interface TraceableRequest {
  readonly method: string;
  readonly originalUrl?: string;
  readonly url?: string;
  readonly headers: Record<string, string | string[] | undefined>;
}

interface TraceableResponse {
  statusCode?: number;
  setHeader(name: string, value: string): void;
  on(event: string, listener: () => void): void;
}

const SKIP = ["/health", "/readyz", "/metrics", "/docs", "/favicon.ico"];

function header(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

export function tracingMiddleware(req: TraceableRequest, res: TraceableResponse, next: () => void): void {
  const path = (req.originalUrl ?? req.url ?? "").split("?")[0];
  if (!tracer.enabled || SKIP.some((p) => path === p || path.startsWith(`${p}/`))) return next();

  const parent = parseTraceparent(header(req.headers.traceparent));
  const span = tracer.begin(`${req.method} ${path}`, "server", parent, {
    "http.request.method": req.method,
    "url.path": path,
  });
  // Expose the trace id on the response so an operator can correlate a request with its trace.
  res.setHeader("traceparent", formatTraceparent(span.context));

  let ended = false;
  const finish = (): void => {
    if (ended) return;
    ended = true;
    const status = res.statusCode ?? 0;
    span.setAttribute("http.response.status_code", status);
    span.end(status >= 500 ? new Error(`HTTP ${status}`) : undefined);
  };
  res.on("finish", finish);
  res.on("close", finish);

  tracer.runWith(span.context, next);
}
