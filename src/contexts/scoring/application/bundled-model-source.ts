import { Injectable } from "@nestjs/common";
import type { MlModel } from "../domain/ml-features";
import { ML_WEIGHTS } from "../model/ml-weights";
import type { ModelSource } from "./model-source.port";

/** The default source: the weights committed in the image (see scripts/train-ml-model.ts). Always available. */
@Injectable()
export class BundledModelSource implements ModelSource {
  readonly kind = "bundled";
  async load(): Promise<MlModel> {
    return ML_WEIGHTS;
  }
}
