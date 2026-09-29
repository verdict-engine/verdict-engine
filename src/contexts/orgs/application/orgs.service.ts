import { Inject, Injectable, type OnModuleInit } from "@nestjs/common";
import { CLOCK, type Clock } from "@shared/ports/clock.port";
import { ID_GENERATOR, type IdGenerator } from "@shared/ports/id-generator.port";
import { STORE, type Collection, type Store } from "@shared/ports/store.port";
import { DomainError } from "@shared/domain/result";
import { DEFAULT_ORG, currentOrg } from "@shared/adapters/tenant-context";
import { AUTH_PORT, type AuthPort, type UserSummary } from "@contexts/auth/application/auth.port";
import type { Org } from "../domain/org";

const ORGS = "orgs";

/**
 * Tenant management. Orgs live in a global collection (a tenant can't belong to a tenant). Only an
 * admin of the root org (`default`) may create or list tenants — a tenant admin manages only their own
 * users/keys/data, which the store already isolates. Provisioning a tenant creates its org record and
 * its first admin in one step, so that admin can then log in, mint keys, and operate in isolation.
 */
@Injectable()
export class OrgsService implements OnModuleInit {
  private readonly orgs: Collection<Org>;

  constructor(
    @Inject(STORE) store: Store,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUTH_PORT) private readonly auth: AuthPort,
  ) {
    this.orgs = store.collection<Org>(ORGS);
  }

  async onModuleInit(): Promise<void> {
    // The root org always exists, so existing (single-tenant) data has a home and the first admin lands in it.
    await this.orgs.putIfAbsent(DEFAULT_ORG, { id: DEFAULT_ORG, name: "Default", createdAt: this.clock.isoNow() });
  }

  async list(): Promise<Org[]> {
    this.assertRoot();
    return (await this.orgs.all()).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async provision(name: string, adminEmail: string, adminPassword: string): Promise<{ org: Org; admin: UserSummary }> {
    this.assertRoot();
    const label = name.trim();
    if (!label) throw new DomainError("ORG_NAME_REQUIRED", "an org name is required");
    const org: Org = { id: this.ids.next("org"), name: label, createdAt: this.clock.isoNow() };
    await this.orgs.put(org.id, org);
    const admin = await this.auth.createUser(adminEmail, adminPassword, "admin", org.id);
    return { org, admin };
  }

  /** Tenant management is reserved for the root org — a tenant admin can't reach across tenants. */
  private assertRoot(): void {
    if ((currentOrg() ?? DEFAULT_ORG) !== DEFAULT_ORG) {
      throw new DomainError("FORBIDDEN", "only an admin of the root org can manage tenants");
    }
  }
}
