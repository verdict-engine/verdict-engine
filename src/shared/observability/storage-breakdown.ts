import { MODEL, modelSourceKind } from "../../config/model";
import { fileBytes } from "./disk-health";

/**
 * Space consumed by one disk-using component of the deployment — so an operator sees *what* is filling
 * a disk, not just that it's filling. It complements the per-filesystem view (DiskUsage): a filesystem
 * says how full a volume is; a component says which service put the data there.
 */
export interface StorageComponent {
  readonly name: string;
  readonly kind: "database" | "model";
  readonly bytes: number;
  /** The on-disk location, when the component is a plain file (e.g. a disk-backed model). */
  readonly path?: string;
}

/**
 * The disk-consuming components the engine can measure: the document store (its logical size on
 * Postgres) and, when the ML scorer loads its weights from disk, the model file. Other services with
 * their own volumes (Postgres server files, Redis AOF) live in sibling containers and are reported by
 * the per-filesystem [DiskUsage] view when their volumes are mounted in.
 */
export async function storageComponents(storeBytes: number): Promise<StorageComponent[]> {
  const components: StorageComponent[] = [{ name: "Document store", kind: "database", bytes: storeBytes }];
  if (modelSourceKind() === "disk" && MODEL.path) {
    const bytes = await fileBytes(MODEL.path);
    if (bytes !== null) components.push({ name: "ML model file", kind: "model", bytes, path: MODEL.path });
  }
  return components;
}
