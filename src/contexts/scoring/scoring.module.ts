import { Module } from "@nestjs/common";
import { MODEL_PORT } from "./application/model.port";
import { ModelService } from "./application/model.service";
import { SCORER_PORT } from "./application/scorer.port";
import { WeightedScorer } from "./application/weighted-scorer.service";
import { LearnedScorer } from "./application/learned-scorer.service";
import { MlScorer } from "./application/ml-scorer.service";
import { MODEL_SOURCE } from "./application/model-source.port";
import { BundledModelSource } from "./application/bundled-model-source";
import { DiskModelSource } from "./application/disk-model-source";
import { RemoteModelSource } from "./application/remote-model-source";
import { S3ModelSource } from "./application/s3-model-source";
import { ModelController } from "./adapters/http/model.controller";
import { activeScorer } from "./scorer-selection";
import { modelSourceKind } from "../../config/model";

/**
 * The scoring seam. SCORER binds the active scorer — `ml` (trained model), `learned` (adaptive), or
 * the default hand `weighted` rules — and nothing else in the system moves. The ModelService
 * projector runs either way, so the learned weights stay observable at GET /v1/model regardless.
 * The ML scorer's weights load from MODEL_SOURCE — bundled (default), a local file (disk), an HTTPS
 * URL, or S3-compatible object storage — hot-swappable without a redeploy.
 */
const SCORERS = { ml: MlScorer, learned: LearnedScorer, weighted: WeightedScorer } as const;
const SOURCES = { bundled: BundledModelSource, disk: DiskModelSource, url: RemoteModelSource, s3: S3ModelSource } as const;
const scorerProvider = { provide: SCORER_PORT, useClass: SCORERS[activeScorer()] };
const modelSourceProvider = { provide: MODEL_SOURCE, useClass: SOURCES[modelSourceKind()] };

@Module({
  controllers: [ModelController],
  providers: [
    scorerProvider,
    modelSourceProvider,
    ModelService,
    { provide: MODEL_PORT, useExisting: ModelService },
  ],
  exports: [SCORER_PORT],
})
export class ScoringModule {}

export { SCORER_PORT };
