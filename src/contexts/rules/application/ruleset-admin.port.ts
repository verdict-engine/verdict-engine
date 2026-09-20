import type { Ruleset } from "./ruleset-repository.port";

/**
 * The write side of rulesets — author, version and roll back like policies. Every publish
 * is retained immutably; rollback moves the active pointer, never edits or deletes.
 */
export interface RulesetAdminPort {
  publish(ruleset: Ruleset): Promise<void>;
  rollback(eventType: string, toVersion: string): Promise<void>;
  history(eventType: string): Promise<string[]>;
  listActive(): Promise<Ruleset[]>;
}

export const RULESET_ADMIN_PORT = Symbol("RulesetAdminPort");
