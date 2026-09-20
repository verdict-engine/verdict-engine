import { Controller, Get } from "@nestjs/common";
import { ApiOperation, ApiTags } from "@nestjs/swagger";
import { APP_VERSION } from "./version";

@ApiTags("Health")
@Controller()
export class HealthController {
  @Get("health")
  @ApiOperation({ summary: "Health check", description: "Public liveness probe — returns the service name and version." })
  health(): { status: string; name: string; version: string } {
    return { status: "ok", name: "verdict-engine", version: APP_VERSION };
  }
}
