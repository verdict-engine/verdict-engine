import type { Rule } from "../domain/rule";

/**
 * Outbound port: where compiled, versioned rulesets come from. Default adapter reads
 * `.vd` files from git and hot-reloads; the engine never knows which adapter is bound.
 */
export interface Ruleset {
  eventType: string;
  version: string;
  rules: Rule[];
}

export interface RulesetRepositoryPort {
  /** The active ruleset for an event type, at a pinned policy version. */
  load(eventType: string): Promise<{ version: string; rules: Rule[] }>;
  /** Every event type's ruleset — for the config/admin view. */
  listAll(): Promise<Ruleset[]>;
}

export const RULESET_REPOSITORY_PORT = Symbol("RulesetRepositoryPort");
