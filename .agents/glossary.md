# Glossary

Domain words as this codebase uses them. Use these names in code and comments.

| Term | Meaning |
|---|---|
| **RiskEvent** | The one normalized event shape the engine reasons about (`ingest/domain/risk-event.ts`). Every channel maps into it. |
| **Signal** | A named piece of evidence about risk (e.g. `velocity.attempts`, `geo.mismatch`). Surfaced as a rule's `tag`. |
| **Feature / FeatureSnapshot** | Precomputed, point-in-time values read on the request path — velocity counters, aggregates, device facts. |
| **Rule** | A compiled line of the DSL: a `Condition` that, when true, contributes `weight` under a `tag`. Rules **propose**, they don't decide. |
| **RuleHit** | The output of a matched rule: `{ ruleId, tag, weight }`. |
| **RiskScore** | A 0–100 number plus per-tag `contributions` (for explainability) and the `model` that produced it. |
| **Policy** | The pure mapping from score → verdict, as `bands`, plus `onError` (fail-open/closed). Versioned. |
| **Band** | One `[min, max]` range in a policy mapped to a verdict, optionally routed to a review `queue`. |
| **Verdict** | The engine's output: `allow` \| `review` \| `deny`. The product's core primitive. |
| **Decision** | The immutable record of one verdict (score, reasons, policy version, timestamp) — what the API returns and the log stores. |
| **Verdict Log** | Append-only store of Decisions. Never mutated; replayed to backtest and audit. |
| **Fail-open / fail-closed** | The policy's declared outcome when a dependency degrades — `allow` or `deny`. A deliberate choice, not an accident. |
| **Case** | A unit of analyst review, opened from a `review` verdict; carries status + audit trail. |
| **Label** | A ground-truth outcome (`fraud` \| `legit`) from an analyst or chargeback; feeds training and backtesting. |
| **Feedback loop** | Labels → tune rules / train the scorer → better verdicts. |
| **Entity graph** | Links between users, devices, cards, phones used to detect rings (planned, v1.0). |
| **Port** | An interface (`*.port.ts`) — a boundary crossed synchronously. |
| **Adapter** | A concrete implementation of a port (Redis, SQL, git, HTTP, LLM) — private to its context. |
| **DomainEvent** | A past-tense, versioned fact on the `EventBus` — a boundary crossed asynchronously. |
