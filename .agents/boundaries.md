# Boundaries — the one invariant

> A context may import **another context's `application/` surface** (its
> `*.port.ts` and `*.contracts.ts`) — and **never** its `domain/` or `adapters/`.

This is the whole reason the monolith can become services later. It is enforced in
[`../.eslintrc.cjs`](../.eslintrc.cjs) (`no-restricted-imports` blocks
`@contexts/*/domain/*` and `@contexts/*/adapters/*`), so a violation fails
`npm run lint` — not just review.

## Allowed

```ts
// decision orchestrator depends on other contexts' PORTS (interfaces)
import { SCORER_PORT, type ScorerPort } from "@contexts/scoring/application/scorer.port";
import type { RiskEvent } from "@contexts/ingest/application/ingest.port"; // contract type
import { VERDICT_REACHED } from "@contexts/decision/application/decision.contracts"; // event contract
import { EVENT_BUS, type EventBus } from "@shared/ports/event-bus.port"; // shared kernel
import { resolveVerdict } from "../domain/policy"; // same context → relative
```

## Forbidden

```ts
import { WeightedScorer } from "@contexts/scoring/application/weighted-scorer.service"; // reaching for the impl
import type { Rule } from "@contexts/rules/domain/rule";        // another context's domain
import { RedisFeatureStore } from "@contexts/feature-store/adapters/redis/..."; // another context's adapter
```

## If you need a type from another context

Don't import it from that context's `domain/`. **Re-export it from that context's
published `application/` file** (a `*.port.ts` or `*.contracts.ts`) and import from
there. Example: `RiskEvent` lives in `ingest/domain` but is re-exported from
`ingest/application/ingest.port.ts`, which is what everyone imports.

## Two ways to cross, restated

- **Synchronous, you need the answer now** → a **port** (interface call).
- **Reactive, fire-and-forget** → an **event** (`EventBus.publish` / `subscribe`).

If you find yourself wanting a third way (a shared table, a direct service import,
a global singleton), stop — that is the coupling the whole design exists to prevent.
