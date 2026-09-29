import type { PolicyId } from "@shared/domain/ids";
import type { Policy } from "./policy";

/**
 * The policies a fresh deployment starts with, one per event type plus a `*` default. They are
 * written to the store on first boot and thereafter treated like any published version — operator
 * changes (new versions, rollbacks) take precedence and survive restarts. Bands include the v0.4
 * `challenge` (step-up) outcome.
 */
export function seedPolicies(): Array<{ eventType: string; policy: Policy }> {
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
