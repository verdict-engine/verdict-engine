import { Module } from "@nestjs/common";
import { MODEL_PORT } from "./application/model.port";
import { ModelService } from "./application/model.service";
import { SCORER_PORT } from "./application/scorer.port";
import { WeightedScorer } from "./application/weighted-scorer.service";
import { LearnedScorer } from "./application/learned-scorer.service";
import { ModelController } from "./adapters/http/model.controller";
import { activeScorer } from "./scorer-selection";

/**
 * The scoring seam. SCORER=learned binds the adaptive model, otherwise the hand
 * weights stay — one line, nothing else in the system moves. The ModelService
 * projector runs either way, so the learned weights are always observable at
 * GET /v1/model even while the weighted scorer is live.
 */
const scorerProvider =
  activeScorer() === "learned"
    ? { provide: SCORER_PORT, useClass: LearnedScorer }
    : { provide: SCORER_PORT, useClass: WeightedScorer };

@Module({
  controllers: [ModelController],
  providers: [
    scorerProvider,
    ModelService,
    { provide: MODEL_PORT, useExisting: ModelService },
  ],
  exports: [SCORER_PORT],
})
export class ScoringModule {}

export { SCORER_PORT };
