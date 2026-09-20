# Verdict — Architecture

An open-source fraud & risk **decisioning** engine. One event in, one verdict out
(`allow` / `review` / `deny`), inside a hard latency budget — built as a **modular
monolith whose seams are already service boundaries**.

This document is the contract. The code follows it; when they disagree, one of
them is a bug.

---

## 1. The one idea

> **Rules propose. Scoring weighs. Decision decides.**

Those three responsibilities are kept in separate bounded contexts on purpose.
The moment they blur into one pile of `if` statements, the engine stops being
auditable — and an unauditable fraud engine is worthless. Every verdict must be
reconstructable: *this score, from these rules, under this policy version.*

The whole system is one process today. It is designed so that pulling any context
into its own service is a wiring change at the composition root, not a rewrite.

---

## 2. Two ways to cross a boundary — and only two

A context may never reach into another context's `domain/` or `adapters/`. It
collaborates in exactly one of two ways:

| | **Port** (synchronous) | **Event** (asynchronous) |
|---|---|---|
| Shape | a typed interface, `*.port.ts` | a `DomainEvent` on the bus |
| When | on the request path, order matters, you need the answer now | reactive, fan-out, the caller doesn't need to wait |
| Example | Decision → Rules → Scoring | Decision ─▶ `verdict.reached` ─▶ Cases |
| Coupling | caller knows the interface, not the impl | publisher knows nothing about subscribers |

This single rule is what makes the split-to-service story real: a **port** becomes
a network client, an **event** becomes a broker topic — and neither the caller nor
the callee changes.

`.eslintrc.cjs` enforces it mechanically: a context may import another context's
**`application/` surface** (its `*.port.ts` and `*.contracts.ts`) but never its
`domain/` or `adapters/`. Same-context imports stay relative; cross-context
imports go through the `@contexts/*` alias — so the lint only ever sees, and
polices, the real boundaries.

---

## 3. The seven bounded contexts

```
event ─▶ Ingest ─▶ Rules ─▶ Scoring ─▶ Decision ─▶ allow / review / deny
                     ▲          ▲           │
              Feature Store ────┘           ├─▶ (event) Cases ─▶ Feedback
                                            └─▶ append-only Verdict Log
```

| # | Context | Owns | Published port | Emits / consumes |
|---|---------|------|----------------|------------------|
| 1 | **Ingest** | the normalized `RiskEvent` shape + per-channel mappers | `IngestPort` | — |
| 2 | **Feature Store** | velocity counters & rolling aggregates | `FeatureStorePort` | — |
| 3 | **Rules** | the declarative DSL, compiled rules, `RuleHit`s | `RulesEnginePort` | — |
| 4 | **Scoring** | 0–100 `RiskScore` + contributions | `ScorerPort` | — |
| 5 | **Decision** | `Verdict`, `Policy`, the orchestrator, the verdict log | `DecidePort` | emits `verdict.reached` |
| 6 | **Cases** | analyst review queue & audit trail | `CaseRepositoryPort` | consumes `verdict.reached` |
| 7 | **Feedback** | labels from analysts & chargebacks | `FeedbackPort` | feeds Rules/Scoring |

Each is a NestJS `@Module` that binds its adapters **privately** and `exports`
only its port token. The `DecideService` injects `RULES_ENGINE_PORT`,
`SCORER_PORT`, `FEATURE_STORE_PORT` — interfaces, never classes.

---

## 4. The decision loop (the request path)

`DecideService.decide()` is the whole path, and it is *only* orchestration —
it owns no rules math, no scoring, no storage:

```
1. policies.loadFor(type)          policy + version (pinned)
2. features.snapshot(event)        precomputed → sub-ms read
3. rules.evaluate(event, features) → RuleHit[]
4. scorer.score(hits, features)    → RiskScore (0–100 + contributions)
5. resolveVerdict(policy, score)   pure function → Band
6. log.append(decision)            append-only, never mutated
7. bus.publish(verdict.reached)    Cases/analytics react off-path
   └─▶ return Decision
```

If any step throws, the engine **fails on purpose**: it falls to the policy's
declared `fail_open` (→ `allow`) or `fail_closed` (→ `deny`) outcome and still
returns a verdict. A degraded dependency never silently blocks real customers,
and never silently waves fraud through. That choice is data (`policy.onError`),
not a buried `catch`.

The **feedback arc** (Cases, Feedback) hangs off the published event, not off this
method — so the caller gets its verdict the instant it's known.

---

## 5. Folder structure

```
src/
├─ main.ts                     bootstrap (HTTP)         · worker.ts later, same AppModule
├─ app.module.ts              composition root — the only place that sees all 7 contexts
├─ shared/                    the kernel — no business logic, nothing imports "up" into a context
│  ├─ domain/                 DomainEvent · Result · branded ids · value objects
│  ├─ ports/                  EventBus · Clock · Logger  (+ DI tokens)
│  ├─ adapters/               InProcessEventBus · SystemClock   ← swap to Kafka to go distributed
│  └─ shared.module.ts        @Global — provides the kernel ports
└─ contexts/
   ├─ ingest/
   │  ├─ domain/              RiskEvent (the one normalized shape)
   │  ├─ application/         ingest.port.ts
   │  ├─ adapters/            http/ · channel mappers
   │  └─ ingest.module.ts
   ├─ feature-store/
   │  ├─ application/         feature-store.port.ts (FeatureSnapshot)
   │  ├─ adapters/redis/      redis-feature-store.adapter.ts
   │  └─ feature-store.module.ts
   ├─ rules/
   │  ├─ domain/              rule.ts (Rule · Condition · RuleHit)
   │  ├─ application/         rules-engine.port.ts · ruleset-repository.port.ts · *.service.ts
   │  └─ rules.module.ts
   ├─ scoring/
   │  ├─ application/         scorer.port.ts · weighted-scorer.service.ts
   │  ├─ adapters/ml/         ml-scorer.adapter.ts  ← same port, trained model
   │  └─ scoring.module.ts
   ├─ decision/               ★ the heart
   │  ├─ domain/              verdict.ts · policy.ts · events.ts
   │  ├─ application/         decide.port.ts · decide.service.ts (orchestrator)
   │  │                       policy-repository.port.ts · verdict-log.port.ts
   │  ├─ adapters/            http/decision.controller.ts · persistence/ (append-only)
   │  └─ decision.module.ts
   ├─ cases/                  reactive — subscribes to verdict.reached
   └─ feedback/               reactive — labels → training / backtesting
```

Inside every context: `domain/` (pure, no framework) → `application/` (ports +
use-cases) → `adapters/` (framework & I/O). Dependencies point **inward**;
`domain` imports nothing from `adapters`.

---

## 6. How a context becomes a service

Say **Scoring** starts melting under load and needs to scale independently:

1. Stand `scoring/` up as its own process behind an HTTP/gRPC adapter that
   implements `ScorerPort`.
2. In Decision's module, rebind `SCORER_PORT` from `WeightedScorer` to a
   `RemoteScorer` client adapter.
3. Nothing in `DecideService`, Rules, or the domain changes — the port contract
   is identical.

For a reactive context (**Cases**), you instead swap the `InProcessEventBus`
adapter for a Kafka/BullMQ one. Publishers and subscribers are untouched.

That is the entire payoff of paying the modular-monolith tax up front.

---

## 7. Non-negotiables (enforced, not aspirational)

- **No shared tables.** Each context owns its storage; the schema can't become coupling.
- **Ports, not classes.** Every cross-boundary dependency is an injected interface.
- **Append-only verdict log.** Decisions are events; replay reconstructs and backtests.
- **Fail on purpose.** `fail_open` / `fail_closed` is declared per policy.
- **Additive contracts.** Event names and ports only grow; a rename is a new version.
- **Slow work is async.** Enrichment, graph builds, notifications run off the request path.
