import type { Policy } from "../domain/policy";

/** Outbound port: where versioned policies come from (git-backed by default). */
export interface PolicyRepositoryPort {
  loadFor(eventType: string): Promise<Policy>;
}

export const POLICY_REPOSITORY_PORT = Symbol("PolicyRepositoryPort");
