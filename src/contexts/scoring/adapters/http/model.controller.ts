import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "@shared/adapters/auth.guard";
import { MODEL_PORT, type ModelPort, type TagWeight } from "../../application/model.port";
import { activeScorer } from "../../scorer-selection";

@ApiTags("Model")
@ApiBearerAuth("bearer")
@Controller("v1/model")
@UseGuards(AuthGuard)
export class ModelController {
  constructor(@Inject(MODEL_PORT) private readonly model: ModelPort) {}

  @Get()
  @ApiOperation({ summary: "Active scorer & weights", description: "Which scorer is active (weighted/learned) and the current per-tag weights it applies." })
  async view(): Promise<{ active: string; weights: TagWeight[] }> {
    return { active: activeScorer(), weights: await this.model.weights() };
  }
}
