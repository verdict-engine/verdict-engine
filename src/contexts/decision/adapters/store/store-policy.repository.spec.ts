import { describe, expect, it } from "vitest";
import { MemoryStore } from "@shared/adapters/memory-store.adapter";
import { runWithOrg } from "@shared/adapters/tenant-context";
import type { PolicyId } from "@shared/domain/ids";
import type { Policy } from "../../domain/policy";
import { StorePolicyRepository } from "./store-policy.repository";

/** Boot a repository over the given store — the constructor seeds the cache, onModuleInit hydrates it. */
async function boot(store: MemoryStore): Promise<StorePolicyRepository> {
  const repo = new StorePolicyRepository(store);
  await repo.onModuleInit();
  return repo;
}

describe("StorePolicyRepository persistence", () => {
  it("seeds default policies on first boot", async () => {
    const repo = await boot(new MemoryStore());
    const p = await repo.loadFor("card.authorize");
    expect(p.id).toBe("pol_card_authorize");
    expect(await repo.activeVersion("pol_card_authorize" as PolicyId)).toBe("v0.4.0");
  });

  it("survives a restart: a published version and rollback are reloaded from the store", async () => {
    // A single store shared across two repository instances is exactly a process restart against the
    // same database — the second instance must see what the first one persisted.
    const store = new MemoryStore();
    const id = "pol_card_authorize" as PolicyId;

    const repo1 = await boot(store);
    const v041: Policy = {
      id,
      version: "v0.4.1",
      onError: "fail_closed",
      bands: [{ verdict: "allow", min: 0, max: 100 }],
    };
    await repo1.publish(v041);
    expect(await repo1.activeVersion(id)).toBe("v0.4.1");

    // Restart #1: the published version and the updated active pointer are reloaded.
    const repo2 = await boot(store);
    expect(await repo2.activeVersion(id)).toBe("v0.4.1");
    expect(await repo2.history(id)).toEqual(expect.arrayContaining(["v0.4.0", "v0.4.1"]));

    await repo2.rollback(id, "v0.4.0");

    // Restart #2: the rollback (active pointer moved back) is durable too.
    const repo3 = await boot(store);
    expect(await repo3.activeVersion(id)).toBe("v0.4.0");
    expect(await repo3.history(id)).toEqual(expect.arrayContaining(["v0.4.0", "v0.4.1"]));
  });

  it("keeps a published policy override private to its org; other orgs see the default", async () => {
    const store = new MemoryStore();
    const id = "pol_card_authorize" as PolicyId;
    const repo = await boot(store);
    const custom: Policy = { id, version: "v9.9.9", onError: "fail_closed", bands: [{ verdict: "deny", min: 0, max: 100 }] };

    await runWithOrg("org_a", () => repo.publish(custom));

    // org_a runs its own version; org_b still falls back to the built-in seed.
    expect(await runWithOrg("org_a", () => repo.activeVersion(id))).toBe("v9.9.9");
    expect(await runWithOrg("org_b", () => repo.activeVersion(id))).toBe("v0.4.0");

    // The override is durable and still private after a restart.
    const repo2 = await boot(store);
    expect(await runWithOrg("org_a", () => repo2.activeVersion(id))).toBe("v9.9.9");
    expect(await runWithOrg("org_b", () => repo2.activeVersion(id))).toBe("v0.4.0");
  });
});
