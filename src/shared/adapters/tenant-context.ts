/**
 * The ambient tenant (org) for the current request, carried on an AsyncLocalStorage so the store can
 * scope reads/writes without every repository threading an org id through its signatures. The auth and
 * API-key guards set it from the authenticated principal; nothing else may.
 *
 * The key rule that keeps multi-tenancy correct: a scoped store operation filters by org ONLY when an
 * org is ambient (i.e. on the request path). Background work — the outbox/webhook/notification relays
 * draining on a timer, and the write-through caches hydrating at boot — runs with NO ambient org and
 * therefore spans every org, which is exactly what those jobs must do. So request traffic is isolated
 * per org, while background processing is not accidentally pinned to one org.
 */
import { AsyncLocalStorage } from "node:async_hooks";

/** The org new rows are attributed to when none is ambient (single-tenant deployments, background writes). */
export const DEFAULT_ORG = "default";

/**
 * Collections that are never scoped by org.
 *
 * - `orgs`: the tenant registry itself — an org record can't live inside another org.
 * - The **identity plane** — `users`, `revoked-tokens`, `user-sessions` — is keyed by globally-unique
 *   identity (email, token jti). Email must be unique system-wide so login (which runs before any org
 *   is ambient) is unambiguous; each user still carries an `orgId`, and per-org user listing is
 *   filtered in the service. API keys stay scoped (their hashes are globally unique, and the pre-auth
 *   lookup runs with no ambient org, so it spans all orgs then).
 * - `policy-routes` (which policy decides which event type) and `config` (runtime rate-limit /
 *   retention / alert settings) stay shared across tenants: event routing is a deployment-wide map,
 *   and per-org operational settings are a later refinement. Decisioning config that tenants customise
 *   — `policies` (band thresholds), `rulesets`, and allow/block/watch `lists` — IS org-scoped, each org
 *   falling back to the built-in defaults until it publishes its own.
 *
 * The decision **data plane** (verdicts, activity, replay, cases, labels, api-keys, webhooks,
 * notifications, deliveries, idempotency, audit) is fully org-scoped.
 */
export const GLOBAL_COLLECTIONS: ReadonlySet<string> = new Set([
  "orgs",
  "users",
  "revoked-tokens",
  "user-sessions",
  "policy-routes",
  "config",
]);

/** The org a scoped collection operation filters by: the ambient org, or none for global collections. */
export function scopeFor(collection: string): string | undefined {
  return GLOBAL_COLLECTIONS.has(collection) ? undefined : currentOrg();
}

const store = new AsyncLocalStorage<string>();

/** Run `fn` with `orgId` as the ambient tenant — the store then scopes scoped collections to it. */
export function runWithOrg<T>(orgId: string, fn: () => T): T {
  return store.run(orgId, fn);
}

/** The ambient org, or undefined when running outside a request (background jobs, boot, tests). */
export function currentOrg(): string | undefined {
  return store.getStore();
}
