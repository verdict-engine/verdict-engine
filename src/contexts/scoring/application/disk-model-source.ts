import { readFile } from "node:fs/promises";
import { Injectable } from "@nestjs/common";
import { causeMessage, logEvent } from "@shared/observability/log";
import { MODEL } from "../../../config/model";
import { type MlModel, validateModel } from "../domain/ml-features";
import type { ModelSource } from "./model-source.port";

/**
 * Loads ML weights from a local JSON file — a path on a mounted volume (`MODEL_PATH`). Lets you drop a
 * retrained model onto the host (or a k8s ConfigMap/volume) and, with MODEL_REFRESH_MINUTES, have it
 * picked up without a redeploy. The file is validated against the engine's feature vector before it
 * serves; on any failure it returns null and the bundled weights keep running.
 */
@Injectable()
export class DiskModelSource implements ModelSource {
  readonly kind = "disk";

  async load(): Promise<MlModel | null> {
    const path = MODEL.path;
    if (!path) return null;
    try {
      const model = validateModel(JSON.parse(await readFile(path, "utf8")));
      if (!model) {
        logEvent("error", "model.disk.rejected", { reason: "shape/feature mismatch" });
        return null;
      }
      logEvent("info", "model.disk.loaded", { trainedAt: model.trainedAt });
      return model;
    } catch (cause) {
      logEvent("warn", "model.disk.load_failed", { cause: causeMessage(cause) });
      return null;
    }
  }
}
