import { beforeEach, describe, expect, it } from "vitest";
import { mock, type MockProxy } from "vitest-mock-extended";
import type { Clock } from "@shared/ports/clock.port";
import type { IdGenerator } from "@shared/ports/id-generator.port";
import { MemoryStore } from "@shared/adapters/memory-store.adapter";
import { AuthService } from "./auth.service";
import { buildTokenConfig } from "./token-config";
import type { UserRepositoryPort } from "./user-repository.port";

describe("AuthService", () => {
  let users: MockProxy<UserRepositoryPort>;
  let svc: AuthService;

  beforeEach(() => {
    users = mock<UserRepositoryPort>();
    const ids = mock<IdGenerator>();
    let n = 0;
    ids.next.mockImplementation((p) => `${p}_${n++}`);
    const clock = mock<Clock>();
    clock.isoNow.mockReturnValue("2026-01-01T00:00:00Z");
    users.findByEmail.mockResolvedValue(null);
    users.hasAny.mockResolvedValue(false);
    const tokens = buildTokenConfig({ AUTH_SECRET: "a-real-32-byte-test-secret-value" } as NodeJS.ProcessEnv);
    svc = new AuthService(users, ids, clock, new MemoryStore(), tokens);
  });

  it("registers the first user as admin", async () => {
    const res = await svc.register("Maya@Bank.com", "supersecret");
    expect(res.user.email).toBe("maya@bank.com");
    expect(res.user.role).toBe("admin");
    expect(users.save.mock.calls[0][0].passwordHash).not.toContain("supersecret");
  });

  it("closes registration once a user exists", async () => {
    users.hasAny.mockResolvedValue(true);
    await expect(svc.register("second@x.com", "supersecret")).rejects.toMatchObject({ code: "REGISTRATION_CLOSED" });
    expect(users.save).not.toHaveBeenCalled();
  });

  it("reports needsBootstrap from whether any user exists", async () => {
    expect(await svc.status()).toEqual({ needsBootstrap: true });
    users.hasAny.mockResolvedValue(true);
    expect(await svc.status()).toEqual({ needsBootstrap: false });
  });

  it("lets an admin create an analyst", async () => {
    const summary = await svc.createUser("ana@x.com", "supersecret", "analyst");
    expect(summary).toMatchObject({ email: "ana@x.com", role: "analyst" });
  });

  it("rejects a weak password", async () => {
    await expect(svc.createUser("a@b.com", "short", "analyst")).rejects.toMatchObject({ code: "WEAK_PASSWORD" });
  });

  it("rejects a duplicate email", async () => {
    users.findByEmail.mockResolvedValue({ id: "u", email: "a@b.com", passwordHash: "x:y", role: "analyst", createdAt: "t" });
    await expect(svc.createUser("a@b.com", "supersecret", "analyst")).rejects.toMatchObject({ code: "EMAIL_TAKEN" });
  });

  it("logs in with the right password, rejects a wrong one, and verifies tokens", async () => {
    const { token } = await svc.register("a@b.com", "supersecret");
    users.findByEmail.mockResolvedValue(users.save.mock.calls[0][0]);

    expect((await svc.login("a@b.com", "supersecret")).user.role).toBe("admin");
    await expect(svc.login("a@b.com", "wrongpass")).rejects.toMatchObject({ code: "INVALID_CREDENTIALS" });
    expect((await svc.verify(token))?.email).toBe("a@b.com");
  });

  it("rejects a revoked token after logout", async () => {
    const { token } = await svc.register("a@b.com", "supersecret");
    expect((await svc.verify(token))?.email).toBe("a@b.com");

    await svc.logout(token);

    expect(await svc.verify(token)).toBeNull();
  });

  it("rejects a garbage or wrong-issuer token", async () => {
    expect(await svc.verify("not-a-token")).toBeNull();
    expect(await svc.verify("")).toBeNull();
  });

  it("refreshes a valid token into a new one", async () => {
    const { token } = await svc.register("a@b.com", "supersecret");
    users.findByEmail.mockResolvedValue(users.save.mock.calls[0][0]);

    const refreshed = await svc.refresh(token);

    expect(refreshed.user.email).toBe("a@b.com");
    expect(refreshed.token).not.toBe(token); // a fresh jti/iat
    expect((await svc.verify(refreshed.token))?.email).toBe("a@b.com");
  });
});
