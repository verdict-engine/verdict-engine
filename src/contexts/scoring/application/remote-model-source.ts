import { Injectable } from "@nestjs/common";
import { causeMessage, logEvent } from "@shared/observability/log";
import { MODEL } from "../../../config/model";
import { type MlModel, validateModel } from "../domain/ml-features";
import type { ModelSource } from "./model-source.port";

/**
 * Loads ML weights from an HTTPS URL (a cloud bucket / CDN / model registry). The fetch is bounded by
 * a timeout and the result is validated against this engine's feature vector before it's accepted, so
 * a corrupt or mismatched model can never serve. On any failure it returns null and the scorer keeps
 * its last-known-good weights — the model source is never on the decision path.
 */
@Injectable()
export class RemoteModelSource implements ModelSource {
  readonly kind = "remote";

  async load(): Promise<MlModel | null> {
    const url = MODEL.url;
    if (!url || !/^https:\/\//.test(url)) {
      logEvent("warn", "model.remote.bad_url", { url: url ? "non-https" : "unset" });
      return null;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MODEL.timeoutMs);
    try {
      const res = await fetch(url, { signal: controller.signal });
      if (!res.ok) {
        logEvent("warn", "model.remote.load_failed", { status: res.status });
        return null;
      }
      const model = validateModel(await res.json());
      if (!model) {
        logEvent("error", "model.remote.rejected", { reason: "shape/feature mismatch" });
        return null;
      }
      logEvent("info", "model.remote.loaded", { trainedAt: model.trainedAt, auc: model.metrics.auc });
      return model;
    } catch (cause) {
      logEvent("warn", "model.remote.load_failed", { cause: causeMessage(cause) });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
