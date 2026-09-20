# Playbook — add a rule, a signal, or a new event channel

Three related tasks. All are **additive** — never change an existing contract.

## Add a rule (no new data needed)

Rules are authored in the DSL under `rules/*.vd`, compiled to `Rule` objects
(`rules/domain/rule.ts`). To add one, add a `rule { when … then score += N, tag "x" }`
block. No code change if the `when` only references existing signals/features.
Remember: a rule **proposes** (adds weight + a tag); it never returns a verdict.

## Add a signal / feature

If the rule needs data that isn't in the `FeatureSnapshot` yet:

1. Extend `FeatureSnapshot` in `feature-store/application/feature-store.port.ts`
   with a **new optional field** (additive — don't change existing ones).
2. Compute it in the adapter: increment/read it in
   `feature-store/adapters/redis/redis-feature-store.adapter.ts` (`record` writes,
   `snapshot` reads).
3. Reference it from a rule's `Condition` path.
4. Unit-test the scorer/rules against a `FeatureSnapshot` fixture including the new field.

## Add a new event channel (e.g. `card.authorize`, `wallet.withdraw`)

The engine is **channel-agnostic** — a new channel is a new mapping, not new core
logic:

1. Add the `type` to `RiskEventType` in `ingest/domain/risk-event.ts` (additive).
2. Add a channel **mapper** in `ingest/adapters/` that normalizes the raw payload
   into a `RiskEvent` (validate at the edge).
3. Add/point a **policy** for that type (`policies/*.vd`) with its bands + fail mode.
4. Everything downstream (features, rules, scoring, decision) already works — it
   only ever sees `RiskEvent`.

> Keep the core generic. Card/credit, wallet, login and local-rail channels are all
> just mappings + policies. Market-specific detectors (e.g. SIM-swap, agent fraud)
> belong in an **optional signal pack**, never hard-wired into the core path.

## Verify

`npm run type-check` · `npm run lint` · `npm run test`.
