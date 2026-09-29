import { timingSafeEqual } from "node:crypto";
import { Controller, Get, Header, Req, UnauthorizedException } from "@nestjs/common";
import { ApiOperation, ApiSecurity, ApiTags } from "@nestjs/swagger";
import { registry } from "./shared/observability/metrics";

/** The slice of the HTTP request we read — avoids depending on express's types. */
interface RequestWithHeaders {
  header(name: string): string | undefined;
}

/** Constant-time token comparison so a wrong metrics token can't be brute-forced by timing. */
function tokenMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

@ApiTags("Health")
@ApiSecurity("metrics-token")
@Controller()
export class MetricsController {
  @Get("metrics")
  @Header("content-type", "text/plain; version=0.0.4; charset=utf-8")
  @ApiOperation({
    summary: "Prometheus metrics",
    description:
      "Operational metrics in Prometheus text format. Public by default — keep the port private behind your proxy. Set METRICS_TOKEN to require it as `Authorization: Bearer <token>` (or the X-Metrics-Token header), so the endpoint can be exposed safely.",
  })
  metrics(@Req() req: RequestWithHeaders): string {
    const expected = process.env.METRICS_TOKEN;
    if (expected) {
      const header = req.header("authorization");
      const provided = header?.startsWith("Bearer ") ? header.slice(7) : req.header("x-metrics-token");
      if (!provided || !tokenMatches(provided, expected)) {
        throw new UnauthorizedException();
      }
    }
    return registry.render();
  }
}
