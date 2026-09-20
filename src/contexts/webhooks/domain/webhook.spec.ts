import { describe, expect, it } from "vitest";
import { newSecret, signBody, summarize, type WebhookEndpoint } from "./webhook";

describe("webhook domain", () => {
  it("signs deterministically and verifiably", () => {
    const body = JSON.stringify({ type: "verdict.reached.v1", data: { verdict: "review" } });
    const sig = signBody("whsec_test", body);
    expect(sig).toMatch(/^sha256=[0-9a-f]{64}$/);
    expect(signBody("whsec_test", body)).toBe(sig); // deterministic
    expect(signBody("whsec_other", body)).not.toBe(sig); // secret-bound
    expect(signBody("whsec_test", `${body} `)).not.toBe(sig); // body-bound (tamper-evident)
  });

  it("mints prefixed secrets", () => {
    expect(newSecret()).toMatch(/^whsec_[0-9a-f]{48}$/);
  });

  it("never exposes the secret in a summary", () => {
    const e: WebhookEndpoint = {
      id: "whk_1", url: "https://x.test/h", events: ["verdict.reached.v1"], secret: "whsec_secret",
      active: true, createdAt: "t", createdBy: "admin@bank.com", failures: 0,
    };
    expect(JSON.stringify(summarize(e))).not.toContain("whsec_secret");
  });
});
