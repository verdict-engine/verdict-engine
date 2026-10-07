import type { Verdict } from "./verdict";

/**
 * Three layers of "why", each for a different audience, so a decline can be explained without teaching
 * a fraudster which rule fired:
 *
 *  1. `reasons`  (on Decision) — the raw rule tags + points. Internal / analyst only.
 *  2. `reasonCodes` (here)     — stable, documented, machine-readable codes + category. For the
 *     MERCHANT's ops / dispute team: enough to action a chargeback, never shown to the end customer.
 *  3. `customerMessage` (here) — one vague, verdict-level line the merchant can safely show the end
 *     customer. It never names a signal, so it can't be probed to reverse-engineer the rules.
 *
 * Reason codes are a published contract: the `code` strings are stable (append new ones, never rename),
 * so integrators can map and alert on them. Categories group codes for coarse reporting.
 */
export type ReasonCategory =
  | "velocity"
  | "authentication"
  | "device"
  | "network"
  | "amount"
  | "anomaly"
  | "list"
  | "system"
  | "other";

export interface ReasonCode {
  /** Stable, documented identifier — safe to log, alert on, and map. Never shown to an end customer. */
  readonly code: string;
  readonly category: ReasonCategory;
}

/** Internal rule tag → the merchant-facing code it maps to. Tags not listed fall back to RISK_OTHER. */
const TAG_TO_CODE: Readonly<Record<string, ReasonCode>> = {
  velocity: { code: "VELOCITY_HIGH", category: "velocity" },
  login_velocity: { code: "VELOCITY_HIGH", category: "velocity" },
  takeover: { code: "ACCOUNT_TAKEOVER", category: "authentication" },
  no_3ds: { code: "AUTH_WEAK", category: "authentication" },
  new_device: { code: "DEVICE_NEW", category: "device" },
  shared_device: { code: "DEVICE_SHARED", category: "device" },
  shared_ip: { code: "NETWORK_SHARED_IP", category: "network" },
  ring: { code: "NETWORK_RING", category: "network" },
  sim_box: { code: "NETWORK_SIM", category: "network" },
  amount: { code: "AMOUNT_HIGH", category: "amount" },
  amount_spike: { code: "AMOUNT_ANOMALY", category: "anomaly" },
  anomaly: { code: "ANOMALY", category: "anomaly" },
  "list.block": { code: "BLOCKLISTED", category: "list" },
  "list.watch": { code: "WATCHLISTED", category: "list" },
  "engine.degraded": { code: "SYSTEM_DEGRADED", category: "system" },
};

const OTHER: ReasonCode = { code: "RISK_OTHER", category: "other" };

/**
 * The full published catalog: every reason code the engine can emit, with its category and what it
 * means. This is the contract integrators map and alert on — the Swagger enum and the docs reference
 * table are both built from it, so they can never drift from what the engine actually returns.
 */
export const REASON_CODE_CATALOG: ReadonlyArray<ReasonCode & { readonly meaning: string }> = [
  { code: "VELOCITY_HIGH", category: "velocity", meaning: "Too many attempts in a short window." },
  { code: "ACCOUNT_TAKEOVER", category: "authentication", meaning: "New device combined with a location/SIM mismatch — possible takeover." },
  { code: "AUTH_WEAK", category: "authentication", meaning: "Strong authentication (e.g. 3-D Secure) was absent on a risky transaction." },
  { code: "DEVICE_NEW", category: "device", meaning: "First time this device/client has been seen." },
  { code: "DEVICE_SHARED", category: "device", meaning: "Device shared across an unusual number of users." },
  { code: "NETWORK_SHARED_IP", category: "network", meaning: "IP shared across an unusual number of users." },
  { code: "NETWORK_RING", category: "network", meaning: "Entity sits in a dense cluster — a likely fraud ring." },
  { code: "NETWORK_SIM", category: "network", meaning: "Phone/SIM shared across many users — possible SIM farm." },
  { code: "AMOUNT_HIGH", category: "amount", meaning: "Transaction amount above the configured threshold." },
  { code: "AMOUNT_ANOMALY", category: "anomaly", meaning: "Amount far outside this user's normal range." },
  { code: "ANOMALY", category: "anomaly", meaning: "Behaviour outside this user's established baseline (e.g. a dormant account spiking)." },
  { code: "BLOCKLISTED", category: "list", meaning: "A subject on the block list." },
  { code: "WATCHLISTED", category: "list", meaning: "A subject on the watch list — routed to review." },
  { code: "SYSTEM_DEGRADED", category: "system", meaning: "A dependency was degraded; the policy's fail-open/closed verdict was applied." },
  { code: "RISK_OTHER", category: "other", meaning: "A custom (operator-authored) rule fired, with no mapped code." },
];

/** Just the code strings, for schema enums. Stable: append new codes, never rename an existing one. */
export const REASON_CODES: ReadonlyArray<string> = REASON_CODE_CATALOG.map((c) => c.code);

/** Codes an end-customer message must never hint at (allow/watch aren't decline reasons). */
const NOT_A_DECLINE = new Set(["list.allow"]);

/**
 * Map the fired rule tags to the merchant-facing reason codes, de-duplicated and in input order
 * (highest-weight first, since `reasons` arrive score-ordered). A tag with no mapping becomes
 * RISK_OTHER rather than leaking the raw tag.
 */
export function reasonCodesFrom(reasons: ReadonlyArray<{ readonly tag: string }>): ReasonCode[] {
  const seen = new Set<string>();
  const out: ReasonCode[] = [];
  for (const { tag } of reasons) {
    if (NOT_A_DECLINE.has(tag)) continue;
    const mapped = TAG_TO_CODE[tag] ?? OTHER;
    if (seen.has(mapped.code)) continue;
    seen.add(mapped.code);
    out.push(mapped);
  }
  return out;
}

/**
 * The single vague line safe to show the end customer, by verdict. Deliberately generic — it reveals
 * only the outcome, never a signal — so it can't be probed to learn which rule fired.
 */
export function customerMessageFor(verdict: Verdict): string {
  switch (verdict) {
    case "deny":
      return "This transaction could not be completed. Please try another payment method or contact support.";
    case "review":
      return "This transaction is being reviewed and will be processed shortly.";
    case "challenge":
      return "Additional verification is required to complete this transaction.";
    default:
      return "Approved.";
  }
}
