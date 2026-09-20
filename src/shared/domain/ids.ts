/**
 * Branded id types: a UserId can never be silently passed where a CaseId is expected —
 * the compiler treats them as distinct even though both are strings.
 */
type Brand<K, T> = K & { readonly __brand: T };

export type EventId = Brand<string, "EventId">;
export type UserId = Brand<string, "UserId">;
export type DeviceId = Brand<string, "DeviceId">;
export type VerdictId = Brand<string, "VerdictId">;
export type CaseId = Brand<string, "CaseId">;
export type PolicyId = Brand<string, "PolicyId">;

/** Prefixed, sortable id (`vd_...`, `cse_...`). Adapter supplies the generator. */
export const prefixedId = (prefix: string, rand: () => string): string =>
  `${prefix}_${rand()}`;
