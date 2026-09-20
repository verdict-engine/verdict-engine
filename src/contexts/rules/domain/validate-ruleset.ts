import type { Condition, Rule } from "./rule";

const OPS: ReadonlySet<string> = new Set(["gt", "gte", "lt", "lte", "eq", "neq"]);

/** Namespaces a condition path may address — anything else never matches and is rejected on publish. */
const NAMESPACES = ["event.", "instrument.", "velocity.", "device.", "geo.", "graph.", "anomaly.", "attr."];

function validateCondition(c: Condition): string | null {
  if (c.kind === "and") {
    if (!Array.isArray(c.all) || c.all.length === 0) return "an 'all' condition needs at least one term";
    for (const sub of c.all) { const e = validateCondition(sub); if (e) return e; }
    return null;
  }
  if (c.kind === "or") {
    if (!Array.isArray(c.any) || c.any.length === 0) return "an 'any' condition needs at least one term";
    for (const sub of c.any) { const e = validateCondition(sub); if (e) return e; }
    return null;
  }
  if (c.kind === "compare") {
    if (!c.path || !NAMESPACES.some((n) => c.path.startsWith(n))) return `unknown signal "${c.path}"`;
    if (!OPS.has(c.op)) return `unknown operator "${c.op}"`;
    if (c.value === undefined || c.value === null || (typeof c.value === "number" && Number.isNaN(c.value))) {
      return `condition on "${c.path}" needs a value`;
    }
    return null;
  }
  return "unknown condition kind";
}

/**
 * Validates a ruleset before it's published: unique ids, a tag, a sane weight, and a
 * well-formed condition over known signals. Returns an error message, or null when valid.
 */
export function validateRuleset(rules: Rule[]): string | null {
  if (!Array.isArray(rules)) return "rules must be an array";
  const ids = new Set<string>();
  for (const rule of rules) {
    if (!rule.id?.trim()) return "every rule needs an id";
    if (ids.has(rule.id)) return `duplicate rule id "${rule.id}"`;
    ids.add(rule.id);
    if (!rule.tag?.trim()) return `rule "${rule.id}" needs a tag`;
    if (typeof rule.weight !== "number" || !Number.isFinite(rule.weight) || rule.weight < 0 || rule.weight > 100) {
      return `rule "${rule.id}" weight must be a number 0–100`;
    }
    const e = validateCondition(rule.condition);
    if (e) return `rule "${rule.id}": ${e}`;
  }
  return null;
}
