import { describe, expect, it } from "vitest";
import { type StatFsResult, diskUsage, fileBytes } from "./disk-health";

function fakeStatfs(result: StatFsResult): (path: string) => Promise<StatFsResult> {
  return async () => result;
}

describe("diskUsage", () => {
  it("computes total, free (available) and used percent from statfs blocks", async () => {
    // 1000 blocks of 4KiB = ~4MB total; 250 free to unprivileged; 200 truly free.
    const usage = await diskUsage("/data", fakeStatfs({ bsize: 4096, blocks: 1000, bfree: 200, bavail: 250 }));
    expect(usage).not.toBeNull();
    expect(usage?.totalBytes).toBe(1000 * 4096);
    expect(usage?.freeBytes).toBe(250 * 4096);
    expect(usage?.usedBytes).toBe(800 * 4096); // blocks - bfree
    expect(usage?.usedPercent).toBe(80); // (1000 - 200) / 1000
  });

  it("returns null for a zero-size filesystem", async () => {
    const usage = await diskUsage("/empty", fakeStatfs({ bsize: 0, blocks: 0, bfree: 0, bavail: 0 }));
    expect(usage).toBeNull();
  });

  it("returns null when the path can't be probed", async () => {
    const usage = await diskUsage("/nope", () => Promise.reject(new Error("ENOENT")));
    expect(usage).toBeNull();
  });

  it("never reports negative free space when bavail is negative", async () => {
    // bavail can go negative on some filesystems when reserved blocks are exceeded.
    const usage = await diskUsage("/full", fakeStatfs({ bsize: 4096, blocks: 1000, bfree: 5, bavail: -10 }));
    expect(usage?.freeBytes).toBe(0);
    expect(usage?.usedPercent).toBe(100); // (1000 - 5) / 1000 rounds to 100
  });
});

describe("fileBytes", () => {
  it("returns null for a missing file", async () => {
    expect(await fileBytes("/does/not/exist.json")).toBeNull();
  });
});
