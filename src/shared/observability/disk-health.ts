import { stat, statfs } from "node:fs/promises";

/**
 * Filesystem health for a mounted path — the *server disk* the store or a disk-backed model lives on,
 * as opposed to the logical size of the document store. In a Docker deployment this is how an operator
 * sees a volume filling up before a write fails: point it at the mounts that hold durable data.
 */
export interface DiskUsage {
  readonly path: string;
  /** Total size of the filesystem the path is on. */
  readonly totalBytes: number;
  /** Space still available to the engine (unprivileged) on that filesystem. */
  readonly freeBytes: number;
  readonly usedBytes: number;
  /** Whole-number percent of the filesystem in use, 0–100. */
  readonly usedPercent: number;
}

/** Size in bytes of a single file (e.g. a disk-backed model), or null when it can't be read. */
export async function fileBytes(path: string): Promise<number | null> {
  try {
    return (await stat(path)).size;
  } catch {
    return null;
  }
}

/** The slice of `fs.statfs`'s result we use. Injectable so the computation is unit-testable. */
export interface StatFsResult {
  readonly bsize: number;
  readonly blocks: number;
  readonly bfree: number;
  readonly bavail: number;
}

type StatFs = (path: string) => Promise<StatFsResult>;

/** Filesystem usage for one path, or null if the path can't be probed (missing / unsupported). */
export async function diskUsage(path: string, probe: StatFs = statfs): Promise<DiskUsage | null> {
  try {
    const s = await probe(path);
    const total = s.blocks * s.bsize;
    if (total <= 0) return null;
    // bavail (available to unprivileged writers) is the "free" that matters for a write failing;
    // usedPercent is computed against bfree so it matches what `df` reports for the whole filesystem.
    const free = Math.max(0, s.bavail) * s.bsize;
    const used = Math.max(0, s.blocks - s.bfree) * s.bsize;
    const usedPercent = Math.round(((s.blocks - s.bfree) / s.blocks) * 100);
    return { path, totalBytes: total, freeBytes: free, usedBytes: used, usedPercent };
  } catch {
    return null;
  }
}

/**
 * Usage for several paths, with paths on the same filesystem collapsed to one entry (so a volume
 * mounted at two places isn't double-counted). Unprobeable paths are skipped rather than erroring.
 */
export async function diskHealth(paths: readonly string[]): Promise<DiskUsage[]> {
  const seenDevices = new Set<number>();
  const out: DiskUsage[] = [];
  for (const path of paths) {
    let device: number | null = null;
    try {
      device = (await stat(path)).dev;
    } catch {
      device = null;
    }
    if (device !== null && seenDevices.has(device)) continue;
    const usage = await diskUsage(path);
    if (usage === null) continue;
    if (device !== null) seenDevices.add(device);
    out.push(usage);
  }
  return out;
}
