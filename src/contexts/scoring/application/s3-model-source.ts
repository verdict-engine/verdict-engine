import { Injectable } from "@nestjs/common";
import { causeMessage, logEvent } from "@shared/observability/log";
import { MODEL } from "../../../config/model";
import { signS3Get } from "../domain/aws-sigv4";
import { type MlModel, validateModel } from "../domain/ml-features";
import type { ModelSource } from "./model-source.port";

/**
 * Loads ML weights from S3-compatible object storage (AWS S3, MinIO, Cloudflare R2, DigitalOcean
 * Spaces) with a SigV4-signed GET — no AWS SDK dependency. Credentials come from env and are never
 * logged. The object is validated against the engine's feature vector before it serves; on any failure
 * it returns null and the bundled weights keep running. The decision path never waits on this.
 */
@Injectable()
export class S3ModelSource implements ModelSource {
  readonly kind = "s3";

  async load(): Promise<MlModel | null> {
    const { endpoint, region, bucket, key, accessKeyId, secretAccessKey } = MODEL.s3;
    if (!endpoint || !bucket || !key || !accessKeyId || !secretAccessKey) {
      logEvent("warn", "model.s3.misconfigured", { has: { endpoint: !!endpoint, bucket: !!bucket, key: !!key, creds: !!(accessKeyId && secretAccessKey) } });
      return null;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), MODEL.timeoutMs);
    try {
      const signed = signS3Get({ endpoint, region, bucket, key, accessKeyId, secretAccessKey });
      const res = await fetch(signed.url, { headers: signed.headers, signal: controller.signal });
      if (!res.ok) {
        logEvent("warn", "model.s3.load_failed", { status: res.status });
        return null;
      }
      const model = validateModel(await res.json());
      if (!model) {
        logEvent("error", "model.s3.rejected", { reason: "shape/feature mismatch" });
        return null;
      }
      logEvent("info", "model.s3.loaded", { bucket, key, trainedAt: model.trainedAt });
      return model;
    } catch (cause) {
      logEvent("warn", "model.s3.load_failed", { cause: causeMessage(cause) });
      return null;
    } finally {
      clearTimeout(timer);
    }
  }
}
