import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { STORE, type Store } from "@shared/ports/store.port";
import { DomainError } from "@shared/domain/result";
import { DEFAULT_ORG, currentOrg } from "@shared/adapters/tenant-context";
import type { PolicyId } from "@shared/domain/ids";
import type { Policy } from "../../domain/policy";
import type { PolicyRepositoryPort } from "../../application/policy-repository.port";
import type { ActivePolicy, PolicyAdminPort } from "../../application/policy-admin.port";
import { seedPolicies } from "../../domain/seed-policies";

const POLICIES = "policies";
const ROUTES = "policy-routes";

/** Durable record of one policy for one org: every published version, immutable, plus the active pointer. */
interface PolicyRecord {
  readonly id: string;
  readonly active: string;
  readonly versions: Record<string, Policy>;
  /** The owning tenant, stored in the record so boot hydration (which reads all orgs) can bucket by it. */
  readonly orgId?: string;
}

/** Maps an event type to the policy that decides it. Deployment-wide (shared across tenants). */
interface RouteRecord {
  readonly eventType: string;
  readonly policyId: string;
}

/**
 * Store-backed versioned policy repository — the read and admin ports. Reads on the decision path stay
 * O(1) via a write-through in-memory cache; every published version and rollback is persisted, so
 * runtime changes survive a restart.
 *
 * Multi-tenant: policy versions are **per org**. Each tenant falls back to the built-in seed policy
 * until it publishes its own, and once it does, that override is private to the org — one tenant's
 * threshold changes never affect another's. Event routing (which policy id handles which event type)
 * is deployment-wide. In a multi-replica deployment a change published on one replica reaches the
 * others on their next restart.
 */
@Injectable()
export class StorePolicyRepository implements PolicyRepositoryPort, PolicyAdminPort, OnModuleInit {
  private readonly seedVersions = new Map<PolicyId, Map<string, Policy>>();
  private readonly seedActive = new Map<PolicyId, string>();
  private readonly typeToPolicy = new Map<string, PolicyId>();
  private readonly versionsByOrg = new Map<string, Map<PolicyId, Map<string, Policy>>>();
  private readonly activeByOrg = new Map<string, Map<PolicyId, string>>();

  constructor(@Inject(STORE) private readonly store: Store) {
    this.seedCache();
  }

  async onModuleInit(): Promise<void> {
    await this.hydrate();
  }

  async loadFor(eventType: string): Promise<Policy> {
    const policyId = this.typeToPolicy.get(eventType) ?? this.typeToPolicy.get("*");
    if (!policyId) throw new DomainError("POLICY_MISSING", `no policy for ${eventType}`);
    return this.current(this.org(), policyId);
  }

  async publish(policy: Policy): Promise<void> {
    const org = this.org();
    this.cachePut(org, policy);
    await this.persist(org, policy.id);
  }

  async rollback(policyId: PolicyId, toVersion: string): Promise<void> {
    const org = this.org();
    if (!this.versionAt(org, policyId, toVersion)) {
      throw new DomainError("POLICY_VERSION_UNKNOWN", `${policyId}@${toVersion} not found`);
    }
    // Materialise the target version into the org's own set so the rollback is a self-contained override.
    this.cachePut(org, this.versionAt(org, policyId, toVersion) as Policy);
    this.orgActive(org).set(policyId, toVersion);
    await this.persist(org, policyId);
  }

  async activeVersion(policyId: PolicyId): Promise<string> {
    return this.current(this.org(), policyId).version;
  }

  async history(policyId: PolicyId): Promise<string[]> {
    const versions = new Set<string>(this.seedVersions.get(policyId)?.keys() ?? []);
    for (const v of this.versionsByOrg.get(this.org())?.get(policyId)?.keys() ?? []) versions.add(v);
    return [...versions];
  }

  async listActive(): Promise<ActivePolicy[]> {
    const org = this.org();
    return [...this.typeToPolicy.entries()]
      .filter(([eventType]) => eventType !== "*")
      .map(([eventType, policyId]) => ({ eventType, policy: this.current(org, policyId) }));
  }

  private org(): string {
    return currentOrg() ?? DEFAULT_ORG;
  }

  private seedCache(): void {
    for (const seed of seedPolicies()) {
      const versions = this.seedVersions.get(seed.policy.id) ?? new Map<string, Policy>();
      versions.set(seed.policy.version, seed.policy);
      this.seedVersions.set(seed.policy.id, versions);
      this.seedActive.set(seed.policy.id, seed.policy.version);
      this.typeToPolicy.set(seed.eventType, seed.policy.id);
    }
  }

  /** Load persisted per-org overrides and any custom routes over the in-memory seeds. */
  private async hydrate(): Promise<void> {
    for (const rec of await this.store.collection<PolicyRecord>(POLICIES).all()) {
      const org = rec.orgId ?? DEFAULT_ORG;
      const id = rec.id as PolicyId;
      this.orgVersions(org).set(id, new Map(Object.entries(rec.versions)));
      this.orgActive(org).set(id, rec.active);
    }
    for (const route of await this.store.collection<RouteRecord>(ROUTES).all()) {
      this.typeToPolicy.set(route.eventType, route.policyId as PolicyId);
    }
  }

  private async persist(org: string, policyId: PolicyId): Promise<void> {
    const versions = this.versionsByOrg.get(org)?.get(policyId);
    const active = this.activeByOrg.get(org)?.get(policyId);
    if (!versions || !active) return;
    await this.store.collection<PolicyRecord>(POLICIES).put(policyId, {
      id: policyId,
      active,
      versions: Object.fromEntries(versions),
      orgId: org,
    });
  }

  private cachePut(org: string, policy: Policy): void {
    const versions = this.orgVersions(org).get(policy.id) ?? new Map<string, Policy>();
    versions.set(policy.version, policy);
    this.orgVersions(org).set(policy.id, versions);
    this.orgActive(org).set(policy.id, policy.version); // newest published becomes active
  }

  /** The active policy for an org: its own override if present, else the built-in seed. */
  private current(org: string, policyId: PolicyId): Policy {
    const version = this.activeByOrg.get(org)?.get(policyId) ?? this.seedActive.get(policyId);
    const policy = version ? this.versionAt(org, policyId, version) : undefined;
    if (!policy) throw new DomainError("POLICY_MISSING", `no active policy for ${policyId}`);
    return policy;
  }

  private versionAt(org: string, policyId: PolicyId, version: string): Policy | undefined {
    return this.versionsByOrg.get(org)?.get(policyId)?.get(version) ?? this.seedVersions.get(policyId)?.get(version);
  }

  private orgVersions(org: string): Map<PolicyId, Map<string, Policy>> {
    let m = this.versionsByOrg.get(org);
    if (!m) {
      m = new Map();
      this.versionsByOrg.set(org, m);
    }
    return m;
  }

  private orgActive(org: string): Map<PolicyId, string> {
    let m = this.activeByOrg.get(org);
    if (!m) {
      m = new Map();
      this.activeByOrg.set(org, m);
    }
    return m;
  }
}
