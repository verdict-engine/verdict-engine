import { Injectable } from "@nestjs/common";
import { DomainError } from "@shared/domain/result";
import type { PolicyId } from "@shared/domain/ids";
import type { Policy } from "../../domain/policy";
import type { PolicyRepositoryPort } from "../../application/policy-repository.port";
import type { PolicyAdminPort } from "../../application/policy-admin.port";

/**
 * In-memory versioned policy store — implements both the read and admin ports. Every
 * version is retained immutably; rollback only moves the `active` pointer, never edits or deletes.
 */
@Injectable()
export class InMemoryPolicyRepository
  implements PolicyRepositoryPort, PolicyAdminPort
{
  private readonly versions = new Map<PolicyId, Map<string, Policy>>();
  private readonly active = new Map<PolicyId, string>();
  private readonly typeToPolicy = new Map<string, PolicyId>();

  constructor() {
    for (const seed of seedPolicies()) {
      this.store(seed.policy);
      this.typeToPolicy.set(seed.eventType, seed.policy.id);
    }
  }

  async loadFor(eventType: string): Promise<Policy> {
    const policyId = this.typeToPolicy.get(eventType) ?? this.typeToPolicy.get("*");
    if (!policyId) throw new DomainError("POLICY_MISSING", `no policy for ${eventType}`);
    return this.current(policyId);
  }

  async publish(policy: Policy): Promise<void> {
    this.store(policy);
  }

  async rollback(policyId: PolicyId, toVersion: string): Promise<void> {
    const known = this.versions.get(policyId);
    if (!known?.has(toVersion)) {
      throw new DomainError("POLICY_VERSION_UNKNOWN", `${policyId}@${toVersion} not found`);
    }
    this.active.set(policyId, toVersion);
  }

  async activeVersion(policyId: PolicyId): Promise<string> {
    return this.current(policyId).version;
  }

  async history(policyId: PolicyId): Promise<string[]> {
    return [...(this.versions.get(policyId)?.keys() ?? [])];
  }

  async listActive(): Promise<Array<{ eventType: string; policy: Policy }>> {
    return [...this.typeToPolicy.entries()]
      .filter(([eventType]) => eventType !== "*")
      .map(([eventType, policyId]) => ({ eventType, policy: this.current(policyId) }));
  }

  private store(policy: Policy): void {
    const versions = this.versions.get(policy.id) ?? new Map<string, Policy>();
    versions.set(policy.version, policy);
    this.versions.set(policy.id, versions);
    this.active.set(policy.id, policy.version); // newest published becomes active
  }

  private current(policyId: PolicyId): Policy {
    const version = this.active.get(policyId);
    const policy = version ? this.versions.get(policyId)?.get(version) : undefined;
    if (!policy) throw new DomainError("POLICY_MISSING", `no active policy for ${policyId}`);
    return policy;
  }
}

/** Seed policies. Bands include the v0.4 `challenge` (step-up) outcome. */
function seedPolicies(): Array<{ eventType: string; policy: Policy }> {
  const financial = (id: string, onError: "fail_open" | "fail_closed"): Policy => ({
    id: id as PolicyId,
    version: "v0.4.0",
    onError,
    bands: [
      { verdict: "allow", min: 0, max: 24 },
      { verdict: "challenge", min: 25, max: 44 },
      { verdict: "review", min: 45, max: 69, reviewQueue: "risk-ops" },
      { verdict: "deny", min: 70, max: 100 },
    ],
  });
  return [
    { eventType: "card.authorize", policy: financial("pol_card_authorize", "fail_open") },
    { eventType: "payment.authorize", policy: financial("pol_payment_authorize", "fail_open") },
    { eventType: "wallet.withdraw", policy: financial("pol_wallet_withdraw", "fail_closed") },
    {
      eventType: "account.login",
      policy: {
        id: "pol_account_login" as PolicyId,
        version: "v0.4.0",
        onError: "fail_open",
        bands: [
          { verdict: "allow", min: 0, max: 29 },
          { verdict: "challenge", min: 30, max: 59 },
          { verdict: "deny", min: 60, max: 100 },
        ],
      },
    },
    {
      eventType: "*",
      policy: {
        id: "pol_default" as PolicyId,
        version: "v0.4.0",
        onError: "fail_open",
        bands: [
          { verdict: "allow", min: 0, max: 49 },
          { verdict: "review", min: 50, max: 100, reviewQueue: "risk-ops" },
        ],
      },
    },
  ];
}
