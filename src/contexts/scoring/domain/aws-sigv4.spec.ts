import { describe, expect, it } from "vitest";
import { signS3Get, type S3GetParams } from "./aws-sigv4";

const base: S3GetParams = {
  endpoint: "https://s3.amazonaws.com",
  region: "us-east-1",
  bucket: "verdict-models",
  key: "prod/weights.json",
  accessKeyId: "AKIAIOSFODNN7EXAMPLE",
  secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY",
  now: new Date("2026-01-02T03:04:05.000Z"),
};

describe("signS3Get", () => {
  it("builds the path-style object URL", () => {
    expect(signS3Get(base).url).toBe("https://s3.amazonaws.com/verdict-models/prod/weights.json");
  });

  it("emits SigV4 headers with the right shape", () => {
    const { headers } = signS3Get(base);
    expect(headers["x-amz-date"]).toBe("20260102T030405Z");
    expect(headers["x-amz-content-sha256"]).toBe("e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855");
    expect(headers.authorization).toMatch(
      /^AWS4-HMAC-SHA256 Credential=AKIAIOSFODNN7EXAMPLE\/20260102\/us-east-1\/s3\/aws4_request, SignedHeaders=host;x-amz-content-sha256;x-amz-date, Signature=[0-9a-f]{64}$/,
    );
  });

  it("is deterministic for the same inputs and changes with the secret", () => {
    const a = signS3Get(base).headers.authorization;
    const b = signS3Get(base).headers.authorization;
    const c = signS3Get({ ...base, secretAccessKey: "different-secret" }).headers.authorization;
    expect(a).toBe(b);
    expect(a).not.toBe(c);
  });

  it("percent-encodes special characters in the key per path segment (keeping slashes)", () => {
    const { url } = signS3Get({ ...base, key: "models/v 1 (final).json" });
    expect(url).toBe("https://s3.amazonaws.com/verdict-models/models/v%201%20%28final%29.json");
  });

  it("works against a non-AWS S3-compatible endpoint (e.g. MinIO)", () => {
    const signed = signS3Get({ ...base, endpoint: "https://minio.internal:9000", region: "us-east-1" });
    expect(signed.url).toBe("https://minio.internal:9000/verdict-models/prod/weights.json");
    expect(signed.headers.authorization).toContain("Signature=");
  });
});
