import { dirname } from "node:path";

const env = process.env;

/**
 * Which filesystem paths the engine reports disk health for. In a Docker deployment the durable data
 * usually lives on a mounted volume (the Postgres data volume, or a disk-backed model file); point
 * DISK_HEALTH_PATHS at those mounts (comma-separated) to watch them fill. When unset, the engine
 * still reports its own container filesystem as a baseline, plus the model volume when MODEL_PATH is
 * disk-backed. The engine can only see filesystems mounted into its own container — a sibling
 * container's volume must be bind-mounted in (read-only) to appear here.
 */
function resolvePaths(): string[] {
  const explicit = (env.DISK_HEALTH_PATHS ?? "")
    .split(",")
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  const paths = explicit.length > 0 ? explicit : [process.cwd()];
  if (env.MODEL_PATH) paths.push(dirname(env.MODEL_PATH));
  return [...new Set(paths)];
}

export const DISK = {
  paths: resolvePaths(),
};
