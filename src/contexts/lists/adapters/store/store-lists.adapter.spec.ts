import { describe, expect, it } from "vitest";
import { MemoryStore } from "@shared/adapters/memory-store.adapter";
import { runWithOrg } from "@shared/adapters/tenant-context";
import type { RiskEvent } from "@contexts/ingest/application/ingest.port";
import { StoreLists } from "./store-lists.adapter";

const eventFor = (userId: string): RiskEvent => ({ subject: { userId } }) as unknown as RiskEvent;

async function boot(store: MemoryStore): Promise<StoreLists> {
  const lists = new StoreLists(store);
  await lists.onModuleInit();
  return lists;
}

describe("StoreLists persistence", () => {
  it("survives a restart: a block entry is reloaded from the store", async () => {
    const store = new MemoryStore();

    const lists1 = await boot(store);
    await lists1.add({ kind: "block", subject: "user", value: "usr_bad", reason: "chargeback ring" });
    expect((await lists1.check(eventFor("usr_bad"))).decision).toBe("deny");

    // Restart: a fresh index over the same store must still block the user.
    const lists2 = await boot(store);
    const match = await lists2.check(eventFor("usr_bad"));
    expect(match.decision).toBe("deny");
    expect(match.reason).toBe("chargeback ring");
    expect((await lists2.check(eventFor("usr_ok"))).decision).toBe("none");
  });

  it("isolates block lists per org (a block in one tenant never affects another)", async () => {
    const store = new MemoryStore();
    const lists = await boot(store);
    await runWithOrg("org_a", () => lists.add({ kind: "block", subject: "user", value: "usr_bad", reason: "ring" }));

    expect((await runWithOrg("org_a", () => lists.check(eventFor("usr_bad")))).decision).toBe("deny");
    expect((await runWithOrg("org_b", () => lists.check(eventFor("usr_bad")))).decision).toBe("none");

    // The per-org boundary survives a restart (rebuilt from the store, bucketed by the entry's org).
    const lists2 = await boot(store);
    expect((await runWithOrg("org_a", () => lists2.check(eventFor("usr_bad")))).decision).toBe("deny");
    expect((await runWithOrg("org_b", () => lists2.check(eventFor("usr_bad")))).decision).toBe("none");
  });
});
