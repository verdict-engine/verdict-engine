import type { PolicyId } from "@shared/domain/ids";
import type { Policy } from "../domain/policy";

/**
 * The write side of policies, kept separate from the read-only PolicyRepositoryPort so reads stay hot.
 * Publishing is additive (a new immutable version); rollback only re-points the active version, never mutates or loses one.
 */
export interface ActivePolicy {
  eventType: string;
  policy: Policy;
}

export interface PolicyAdminPort {
  publish(policy: Policy): Promise<void>;
  rollback(policyId: PolicyId, toVersion: string): Promise<void>;
  activeVersion(policyId: PolicyId): Promise<string>;
  history(policyId: PolicyId): Promise<string[]>;
  listActive(): Promise<ActivePolicy[]>;
}

export const POLICY_ADMIN_PORT = Symbol("PolicyAdminPort");
