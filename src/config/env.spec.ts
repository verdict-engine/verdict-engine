import { describe, expect, it } from "vitest";
import { ConfigError, loadConfig } from "./env";

const env = (o: Record<string, string | undefined>) => loadConfig(o as NodeJS.ProcessEnv);

describe("loadConfig", () => {
  it("falls back to memory in development with warnings, never throwing", () => {
    const { config, warnings } = env({ NODE_ENV: "development" });
    expect(config.persistence).toBe("memory");
    expect(config.port).toBe(4000);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it("requires AUTH_SECRET and DATABASE_URL in production", () => {
    try {
      env({ NODE_ENV: "production" });
      expect.unreachable("should have thrown");
    } catch (e) {
      expect(e).toBeInstanceOf(ConfigError);
      const problems = (e as ConfigError).problems.join(" ");
      expect(problems).toContain("AUTH_SECRET");
      expect(problems).toContain("DATABASE_URL");
    }
  });

  it("rejects the insecure default AUTH_SECRET in production", () => {
    expect(() => env({ NODE_ENV: "production", AUTH_SECRET: "dev-secret-change-me", DATABASE_URL: "postgres://x" }))
      .toThrow(/placeholder/);
  });

  it("rejects the compose placeholder AUTH_SECRET even though it is long enough", () => {
    expect(() => env({ NODE_ENV: "production", AUTH_SECRET: "change-me-in-production-min-16-chars", DATABASE_URL: "postgres://x" }))
      .toThrow(/placeholder/);
  });

  it("rejects repeated-character filler as AUTH_SECRET", () => {
    expect(() => env({ NODE_ENV: "production", AUTH_SECRET: "aaaaaaaaaaaaaaaaaaaa", DATABASE_URL: "postgres://x" }))
      .toThrow(/placeholder/);
  });

  it("rejects too-short AUTH_SECRET", () => {
    expect(() => env({ NODE_ENV: "production", AUTH_SECRET: "short", DATABASE_URL: "postgres://x" }))
      .toThrow(/at least 16/);
  });

  it("rejects a non-postgres DATABASE_URL", () => {
    expect(() => env({ NODE_ENV: "production", AUTH_SECRET: "0123456789abcdef", DATABASE_URL: "mysql://x" }))
      .toThrow(/postgres/);
  });

  it("rejects an invalid port", () => {
    expect(() => env({ PORT: "not-a-port" })).toThrow(ConfigError);
  });

  it("accepts a valid production config", () => {
    const { config } = env({ NODE_ENV: "production", AUTH_SECRET: "a-real-32-byte-secret-value-here", DATABASE_URL: "postgres://verdict@db/verdict" });
    expect(config.persistence).toBe("postgres");
  });

  it("lets production opt into memory explicitly", () => {
    const { config } = env({ NODE_ENV: "production", AUTH_SECRET: "a-real-32-byte-secret-value-here", PERSISTENCE: "memory" });
    expect(config.persistence).toBe("memory");
  });
});
