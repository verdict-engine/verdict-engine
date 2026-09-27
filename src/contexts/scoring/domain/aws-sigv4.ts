import { createHash, createHmac } from "node:crypto";

/**
 * Minimal AWS Signature Version 4 signer for a single S3 GetObject request (path-style). It's just an
 * HMAC chain over node:crypto, so it works with any S3-compatible endpoint (AWS S3, MinIO, Cloudflare
 * R2, DigitalOcean Spaces) with no SDK dependency. Only what's needed to pull one object is here.
 */
const SERVICE = "s3";
const EMPTY_BODY_SHA256 = createHash("sha256").update("").digest("hex");

const sha256hex = (data: string): string => createHash("sha256").update(data).digest("hex");
const hmac = (key: Buffer | string, data: string): Buffer => createHmac("sha256", key).update(data).digest();
const hmacHex = (key: Buffer, data: string): string => createHmac("sha256", key).update(data).digest("hex");

/** RFC-3986 encoding for a single path segment (S3's canonicalisation): unreserved chars stay, the rest are %-encoded. */
const encodeSegment = (s: string): string =>
  encodeURIComponent(s).replace(/[!*'()]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);

export interface S3GetParams {
  readonly endpoint: string; // https://s3.amazonaws.com or https://minio.internal:9000
  readonly region: string;
  readonly bucket: string;
  readonly key: string;
  readonly accessKeyId: string;
  readonly secretAccessKey: string;
  /** Overridable for deterministic tests; defaults to now. */
  readonly now?: Date;
}

export interface SignedRequest {
  readonly url: string;
  readonly headers: Record<string, string>;
}

/** Produce the URL and signed headers for a path-style S3 GetObject. */
export function signS3Get(p: S3GetParams): SignedRequest {
  const now = p.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]/g, "").replace(/\.\d{3}/, ""); // YYYYMMDDTHHMMSSZ
  const dateStamp = amzDate.slice(0, 8); // YYYYMMDD
  const host = new URL(p.endpoint).host;

  const encodedPath = [p.bucket, ...p.key.split("/")].map(encodeSegment).join("/");
  const canonicalUri = `/${encodedPath}`;
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${EMPTY_BODY_SHA256}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = "host;x-amz-content-sha256;x-amz-date";
  const canonicalRequest = `GET\n${canonicalUri}\n\n${canonicalHeaders}\n${signedHeaders}\n${EMPTY_BODY_SHA256}`;

  const scope = `${dateStamp}/${p.region}/${SERVICE}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${scope}\n${sha256hex(canonicalRequest)}`;

  const kDate = hmac(`AWS4${p.secretAccessKey}`, dateStamp);
  const kRegion = hmac(kDate, p.region);
  const kService = hmac(kRegion, SERVICE);
  const kSigning = hmac(kService, "aws4_request");
  const signature = hmacHex(kSigning, stringToSign);

  const authorization = `AWS4-HMAC-SHA256 Credential=${p.accessKeyId}/${scope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;

  return {
    url: `${p.endpoint.replace(/\/$/, "")}${canonicalUri}`,
    headers: {
      authorization: authorization,
      "x-amz-date": amzDate,
      "x-amz-content-sha256": EMPTY_BODY_SHA256,
    },
  };
}
