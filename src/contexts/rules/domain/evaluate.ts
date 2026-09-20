import type { FeatureSnapshot } from "@contexts/feature-store/application/feature-store.port";
import type { RiskEvent } from "@contexts/ingest/application/ingest.port";
import type { Condition, Rule, RuleHit } from "./rule";

type Scalar = string | number | boolean | undefined;

/** Evaluate a whole ruleset against one (event, features). Pure — the shared core of the
 *  request-path engine and of backtesting a candidate ruleset over the replay log. */
export function evaluateRules(
  rules: readonly Rule[],
  event: RiskEvent,
  features: FeatureSnapshot,
): RuleHit[] {
  const ns = buildNamespace(event, features);
  const hits: RuleHit[] = [];
  for (const rule of rules) {
    if (evaluateCondition(rule.condition, ns)) {
      hits.push({ ruleId: rule.id, tag: rule.tag, weight: rule.weight });
    }
  }
  return hits;
}

/**
 * Flatten (event, features) into the dotted namespace the DSL references
 * (`velocity.attemptsLast2m`, `device.firstSeen`, `attr.<key>`). Pure — no I/O, no clock.
 */
export function buildNamespace(
  event: RiskEvent,
  features: FeatureSnapshot,
): Readonly<Record<string, Scalar>> {
  const ns: Record<string, Scalar> = {
    "event.type": event.type,
    "event.channel": event.subject.channel,
    "event.amount": event.money?.amount,
    "event.currency": event.money?.currency,
    "instrument.kind": event.instrument?.kind,
    "instrument.bin": event.instrument?.bin,
    "instrument.issuerCountry": event.instrument?.issuerCountry,
    "instrument.threeDS": event.instrument?.threeDS,
    "velocity.attemptsLast2m": features.velocity.attemptsLast2m,
    "velocity.attemptsLast24h": features.velocity.attemptsLast24h,
    "velocity.amountLast1h": features.velocity.amountLast1h,
    "device.firstSeen": features.device.firstSeen,
    "device.usersOnDevice": features.device.usersOnDevice,
    "geo.ipSimMismatch": features.geo.ipSimMismatch,
    "graph.usersOnDevice": features.graph?.usersOnDevice,
    "graph.usersOnIp": features.graph?.usersOnIp,
    "graph.usersOnPhone": features.graph?.usersOnPhone,
    "graph.devicesOnUser": features.graph?.devicesOnUser,
    "graph.ringSize": features.graph?.ringSize,
    "anomaly.amountZScore": features.anomaly?.amountZScore,
    "anomaly.amountMean": features.anomaly?.amountMean,
    "anomaly.samples": features.anomaly?.samples,
  };
  for (const [k, v] of Object.entries(event.attributes)) ns[`attr.${k}`] = v;
  return ns;
}

/** Evaluate a compiled condition tree against the namespace. Pure and total. */
export function evaluateCondition(
  condition: Condition,
  ns: Readonly<Record<string, Scalar>>,
): boolean {
  switch (condition.kind) {
    case "and":
      return condition.all.every((c) => evaluateCondition(c, ns));
    case "or":
      return condition.any.some((c) => evaluateCondition(c, ns));
    case "compare":
      return compare(ns[condition.path], condition.op, condition.value);
  }
}

function compare(left: Scalar, op: string, right: Scalar): boolean {
  switch (op) {
    case "eq":
      return left === right;
    case "neq":
      return left !== right;
    case "gt":
      return typeof left === "number" && typeof right === "number" && left > right;
    case "gte":
      return typeof left === "number" && typeof right === "number" && left >= right;
    case "lt":
      return typeof left === "number" && typeof right === "number" && left < right;
    case "lte":
      return typeof left === "number" && typeof right === "number" && left <= right;
    default:
      return false;
  }
}
