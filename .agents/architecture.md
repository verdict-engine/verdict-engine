# Architecture — the one-page mental model

Canonical, detailed version: [`../ARCHITECTURE.md`](../ARCHITECTURE.md). This page
is the compressed model an agent needs in working memory.

## The pipeline

```
event ─▶ Ingest ─▶ Rules ─▶ Scoring ─▶ Decision ─▶ allow / review / deny
                     ▲          ▲           │
              Feature Store ────┘           ├─▶ (event) Cases ─▶ Feedback
                                            └─▶ append-only Verdict Log
```

- **Synchronous request path** (must stay < 100ms): Decision orchestrates
  Ingest → Feature Store → Rules → Scoring → policy → verdict, via **ports**.
- **Asynchronous reactive path:** Decision publishes `verdict.reached`; Cases and
  (future) Analytics **subscribe**. The caller never waits on them.

## The seven contexts (`src/contexts/*`)

| Context | Job | Published port |
|---|---|---|
| ingest | normalize any channel into one `RiskEvent` | `IngestPort` |
| feature-store | velocity counters / aggregates | `FeatureStorePort` |
| rules | evaluate the DSL → `RuleHit[]` (proposes) | `RulesEnginePort` |
| scoring | weigh hits → 0–100 `RiskScore` | `ScorerPort` |
| decision | apply policy → `Verdict`; append log; emit event | `DecidePort` |
| cases | open a review queue from `review` verdicts | `CaseRepositoryPort` |
| feedback | labels from analysts/chargebacks | `FeedbackPort` |

## Layers inside a context

```
domain/       pure types & value objects, no framework, no I/O
application/   ports (*.port.ts) + use-cases/services + published contracts
adapters/      framework & I/O (http controllers, redis, sql, git) — private
<ctx>.module.ts  binds ports→adapters, exports only the port token(s)
```

Dependencies point **inward**: `adapters` → `application` → `domain`. `domain`
imports nothing outward.

## Shared kernel (`src/shared/*`)

Cross-cutting ports every context uses — `EventBus`, `Clock`, `DomainEvent`,
`Result`, branded ids. Holds **no business logic** and knows about **no context**.
The `InProcessEventBus` adapter is what makes this a monolith; swapping it for a
broker adapter is how it becomes distributed.

## The composition root

`src/app.module.ts` is the only file that imports every context. It is also the
**seam map**: to extract a context into a service, remove its module here, stand it
up behind the same ports over the network, rebind the `EventBus` adapter — the
contexts don't change.
