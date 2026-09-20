import type { Condition, Rule } from "./rule";

const OP: Record<string, string> = {
  gt: ">", gte: ">=", lt: "<", lte: "<=", eq: "==", neq: "!=",
};

function condition(c: Condition): string {
  if (c.kind === "and") return c.all.map(condition).join(" && ");
  if (c.kind === "or") return c.any.map(condition).join(" || ");
  const value = typeof c.value === "string" ? `"${c.value}"` : String(c.value);
  return `${c.path} ${OP[c.op] ?? c.op} ${value}`;
}

/** Renders a compiled rule back into its readable DSL form for display. */
export function ruleToDsl(rule: Rule): string {
  return `rule ${rule.id} {\n  when  ${condition(rule.condition)}\n  then  score += ${rule.weight}, tag "${rule.tag}"\n}`;
}
