import { Inject, Injectable } from "@nestjs/common";
import { DomainError } from "@shared/domain/result";
import { STORE, type Collection, type Store } from "@shared/ports/store.port";
import type { Rule } from "../../domain/rule";
import type { Ruleset, RulesetRepositoryPort } from "../../application/ruleset-repository.port";
import type { RulesetAdminPort } from "../../application/ruleset-admin.port";

interface StoredRuleset {
  eventType: string;
  active: string;
  versions: Record<string, Rule[]>;
}

const SEED_VERSION = "seed@v0.4";

/**
 * Store-backed, versioned ruleset repository — the read side the engine evaluates and the
 * admin side the dashboard authors. Every published version is kept immutably; rollback moves
 * the active pointer only. Seed rulesets are written to the store on first access, so a fresh
 * deploy behaves as before and edits then persist.
 */
@Injectable()
export class StoreRulesetRepository implements RulesetRepositoryPort, RulesetAdminPort {
  private readonly rulesets: Collection<StoredRuleset>;

  constructor(@Inject(STORE) store: Store) {
    this.rulesets = store.collection<StoredRuleset>("rulesets");
  }

  async load(eventType: string): Promise<{ version: string; rules: Rule[] }> {
    const doc = await this.ensure(eventType);
    return { version: doc.active, rules: doc.versions[doc.active] ?? [] };
  }

  async listAll(): Promise<Ruleset[]> {
    for (const eventType of Object.keys(SEED)) await this.ensure(eventType);
    return (await this.rulesets.all()).map(toRuleset);
  }

  async publish(ruleset: Ruleset): Promise<void> {
    const doc = (await this.rulesets.get(ruleset.eventType)) ?? emptyDoc(ruleset.eventType);
    doc.versions[ruleset.version] = ruleset.rules;
    doc.active = ruleset.version;
    await this.rulesets.put(ruleset.eventType, doc);
  }

  async rollback(eventType: string, toVersion: string): Promise<void> {
    const doc = await this.rulesets.get(eventType);
    if (!doc?.versions[toVersion]) {
      throw new DomainError("RULESET_VERSION_UNKNOWN", `${eventType}@${toVersion} not found`);
    }
    doc.active = toVersion;
    await this.rulesets.put(eventType, doc);
  }

  async history(eventType: string): Promise<string[]> {
    return Object.keys((await this.ensure(eventType)).versions);
  }

  async listActive(): Promise<Ruleset[]> {
    return this.listAll();
  }

  /** Get the stored ruleset, seeding it from the built-in defaults on first access. */
  private async ensure(eventType: string): Promise<StoredRuleset> {
    const existing = await this.rulesets.get(eventType);
    if (existing) return existing;
    const seed = SEED[eventType];
    const doc: StoredRuleset = seed
      ? { eventType, active: SEED_VERSION, versions: { [SEED_VERSION]: seed } }
      : emptyDoc(eventType);
    await this.rulesets.put(eventType, doc);
    return doc;
  }
}

const emptyDoc = (eventType: string): StoredRuleset => ({ eventType, active: "", versions: {} });

const toRuleset = (doc: StoredRuleset): Ruleset => ({
  eventType: doc.eventType,
  version: doc.active,
  rules: doc.versions[doc.active] ?? [],
});

// ── Built-in seed rulesets (the defaults a fresh deploy starts from) ──────────
function hit(id: string, tag: string, weight: number, condition: Rule["condition"]): Rule {
  return { id, name: id, tag, weight, condition };
}
const gt = (path: string, value: number): Rule["condition"] => ({ kind: "compare", path, op: "gt", value });
const eq = (path: string, value: string | number | boolean): Rule["condition"] => ({ kind: "compare", path, op: "eq", value });
const and = (...all: Rule["condition"][]): Rule["condition"] => ({ kind: "and", all });

const SEED: Record<string, Rule[]> = {
  "card.authorize": [
    hit("r_velocity", "velocity", 28, gt("velocity.attemptsLast2m", 4)),
    hit("r_takeover", "takeover", 33, and(eq("device.firstSeen", true), eq("geo.ipSimMismatch", true))),
    hit("r_no_3ds", "no_3ds", 22, and(eq("instrument.threeDS", false), gt("event.amount", 2000))),
    hit("r_shared_device", "shared_device", 18, gt("device.usersOnDevice", 3)),
    hit("r_ring", "ring", 26, gt("graph.ringSize", 6)),
    hit("r_amount_anomaly", "amount_spike", 22, gt("anomaly.amountZScore", 3)),
    hit("r_large_amount", "amount", 14, gt("event.amount", 3000)),
  ],
  "payment.authorize": [
    hit("r_velocity", "velocity", 28, gt("velocity.attemptsLast2m", 4)),
    hit("r_takeover", "takeover", 33, and(eq("device.firstSeen", true), eq("geo.ipSimMismatch", true))),
    hit("r_ring", "ring", 26, gt("graph.ringSize", 6)),
    hit("r_sim_box", "sim_box", 24, gt("graph.usersOnPhone", 3)),
    hit("r_amount_anomaly", "amount_spike", 22, gt("anomaly.amountZScore", 3)),
    hit("r_large_amount", "amount", 14, gt("event.amount", 3000)),
  ],
  "wallet.withdraw": [
    hit("r_velocity", "velocity", 30, gt("velocity.attemptsLast2m", 3)),
    hit("r_sim_box", "sim_box", 24, gt("graph.usersOnPhone", 3)),
    hit("r_dormant_spike", "anomaly", 16, and(eq("velocity.attemptsLast24h", 0), gt("event.amount", 1000))),
  ],
  "account.login": [
    hit("r_login_velocity", "login_velocity", 30, gt("velocity.attemptsLast2m", 5)),
    hit("r_new_device", "new_device", 12, eq("device.firstSeen", true)),
    hit("r_shared_ip", "shared_ip", 20, gt("graph.usersOnIp", 4)),
  ],
};
