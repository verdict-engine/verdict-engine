import { Controller, Get, Header } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { registry } from "./shared/observability/metrics";

@ApiTags("Health")
@Controller()
export class MetricsController {
  @Get("metrics")
  @Header("content-type", "text/plain; version=0.0.4; charset=utf-8")
  @ApiOperation({
    summary: "Prometheus metrics",
    description: "Operational metrics in Prometheus text format. Public like /health — keep the port private behind your proxy.",
  })
  metrics(): string {
    return registry.render();
  }
}
