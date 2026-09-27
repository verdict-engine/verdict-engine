const int = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

const env = process.env;

export type ModelSourceKind = "bundled" | "disk" | "url" | "s3";

/**
 * Where the ML scorer's weights come from. By default the scorer uses the weights bundled in the
 * image, so it always works offline. It can instead load them from a local file (a mounted volume),
 * an HTTPS URL (a CDN or a presigned object), or directly from S3-compatible object storage
 * (AWS S3, MinIO, Cloudflare R2, DigitalOcean Spaces) with SigV4-signed requests — so you can retrain
 * and roll out a new model without redeploying. A source that fails to load or validate is ignored;
 * the last-known-good (or bundled) weights keep serving, and the fetch never touches the decision path.
 */
export const MODEL = {
  path: env.MODEL_PATH, // local file, e.g. /models/verdict-weights.json
  url: env.MODEL_URL, // https://… (CDN or presigned object)
  s3: {
    endpoint: env.MODEL_S3_ENDPOINT, // https://s3.amazonaws.com or https://minio.internal:9000
    region: env.MODEL_S3_REGION || "us-east-1",
    bucket: env.MODEL_S3_BUCKET,
    key: env.MODEL_S3_KEY,
    accessKeyId: env.MODEL_S3_ACCESS_KEY_ID,
    secretAccessKey: env.MODEL_S3_SECRET_ACCESS_KEY,
  },
  refreshMinutes: int(env.MODEL_REFRESH_MINUTES, 0), // 0 = load once at boot, never refresh
  timeoutMs: int(env.MODEL_FETCH_TIMEOUT_MS, 5000),
};

/**
 * Which source to use, from the env. An explicit `MODEL_SOURCE` wins; otherwise it's inferred from
 * what's configured: S3 (bucket + credentials) → disk (MODEL_PATH) → URL (MODEL_URL) → bundled.
 */
export function modelSourceKind(): ModelSourceKind {
  const explicit = env.MODEL_SOURCE as ModelSourceKind | undefined;
  if (explicit === "bundled" || explicit === "disk" || explicit === "url" || explicit === "s3") return explicit;
  if (MODEL.s3.bucket && MODEL.s3.key && MODEL.s3.accessKeyId && MODEL.s3.secretAccessKey) return "s3";
  if (MODEL.path) return "disk";
  if (MODEL.url) return "url";
  return "bundled";
}
