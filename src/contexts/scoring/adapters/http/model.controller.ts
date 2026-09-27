import { Controller, Get, Inject, UseGuards } from "@nestjs/common";
import { ApiBearerAuth, ApiOperation, ApiTags } from "@nestjs/swagger";
import { AuthGuard } from "@shared/adapters/auth.guard";
import { MODEL_PORT, type ModelPort, type TagWeight } from "../../application/model.port";
import { SCORER_PORT, type ScorerPort } from "../../application/scorer.port";
import { ML_WEIGHTS } from "../../model/ml-weights";
import type { MlModel } from "../../domain/ml-features";
import { activeScorer } from "../../scorer-selection";
import { modelSourceKind } from "../../../../config/model";

/** Present when the active scorer is the ML model (see MlScorer.describe). */
interface Describable {
  describe(): { model: MlModel; source: string };
}
const isDescribable = (s: unknown): s is Describable => typeof (s as Describable).describe === "function";

interface MlModelView {
  active: boolean;
  source: string;
  trainedAt: string;
  metrics: MlModel["metrics"];
  bias: number;
  features: Array<{ name: string; weight: number }>;
}

@ApiTags("Model")
@ApiBearerAuth("bearer")
@Controller("v1")
@UseGuards(AuthGuard)
export class ModelController {
  constructor(
    @Inject(MODEL_PORT) private readonly model: ModelPort,
    @Inject(SCORER_PORT) private readonly scorer: ScorerPort,
  ) {}

  @Get("model")
  @ApiOperation({ summary: "Active scorer & weights", description: "Which scorer is active (weighted/learned) and the current per-tag weights it applies." })
  async view(): Promise<{ active: string; weights: TagWeight[] }> {
    return { active: activeScorer(), weights: await this.model.weights() };
  }

  @Get("config/model")
  @ApiOperation({
    summary: "Scoring model status",
    description:
      "The active scorer (weighted / learned / ml) and, for the ML model, its provenance (bundled or a remote MODEL_URL), training metrics, and per-feature weights. The ml block reflects the live model when SCORER=ml, otherwise the bundled weights as a reference.",
  })
  scoringModel(): { scorer: string; ml: MlModelView } {
    const scorer = activeScorer();
    // Live model when the ML scorer is active; otherwise the bundled weights (what you'd get with SCORER=ml).
    const live = scorer === "ml" && isDescribable(this.scorer) ? this.scorer.describe() : null;
    const model = live?.model ?? ML_WEIGHTS;
    return {
      scorer,
      ml: {
        active: scorer === "ml",
        source: live?.source ?? modelSourceKind(),
        trainedAt: model.trainedAt,
        metrics: model.metrics,
        bias: model.bias,
        features: model.featureNames.map((name, i) => ({ name, weight: model.weights[i] })),
      },
    };
  }
}
