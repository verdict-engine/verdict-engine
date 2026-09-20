/**
 * IdGenerator — id creation is an injected dependency, so tests can pin ids and
 * production can swap in ULID/KSUID without touching domain code.
 */
export interface IdGenerator {
  /** Returns a prefixed, roughly-sortable id, e.g. `vd_01J9…`. */
  next(prefix: string): string;
}

export const ID_GENERATOR = Symbol("IdGenerator");
