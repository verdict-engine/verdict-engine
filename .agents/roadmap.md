# Roadmap & reserved seams

For agents extending the code: this is the intended direction, so new work should
fit these grooves rather than cut across them.

## Positioning (important)

Verdict is **channel- and rail-agnostic**. Card/credit systems are first-class
(authorize/capture/refund, 3DS step-up, chargebacks). Local payment rails
(Chapa, Telebirr, SMS-OTP) are **connectors + one optional signal pack**, never the
center of gravity. Keep the core generic; put market-specific detectors in packs.

## Cross-cutting track — quality (every phase, not a phase)

- **Unit tests** — each port mocked with `vitest-mock-extended`; domain logic
  (policy bands, scorer, rule evaluation) tested pure.
- **E2E tests** — `supertest` against the HTTP adapter with in-memory adapters
  wired, asserting the `allow` / `review` / `deny` paths end to end.
- CI gate: `type-check` + `lint` (incl. boundary rules) + `test` must pass.

## Phases

| Phase | Theme | Highlights |
|---|---|---|
| **v0.1** ✅ | Decision loop | ingest · rules · sync decision API · velocity counters · append-only log · **testing foundation** |
| **v0.4** ✅ | Decisioning depth (credit-ready) | weighted scoring · step-up `challenge` · block/allow/watch lists · versioned policies + rollback · idempotency + outbox · card/credit event types (authorize/capture/refund). Runs on in-memory adapters; unit + e2e green |
| **v0.7** ✅ | Human in the loop + first dashboard | case management (queue/assign/resolve) · append-only audit trail · analyst + **chargeback** label capture (closes the feedback loop) · operator dashboard (`verdict-dashboard`, live-wired). Alerting/SLAs still deferred |
| **v1.0** ✅ | Intelligence & analytics | ✅ **analytics read-model (CQRS)** + dashboard analytics · ✅ **pluggable ML scoring port** (`LearnedScorer` behind `ScorerPort`; `SCORER=learned`, observable at `GET /v1/model`) · ✅ **closed feedback loop** (`label.recorded` for analyst + chargeback → scoring + analytics learn from both) · ✅ **rule/policy backtesting w/ full replay** (replay log stores event+features per decision; `POST /v1/backtest` re-runs a candidate rule/policy over labeled history; dashboard test-before-publish) · ✅ **entity graph** (`graph` context — links user/device/ip; `graph.*` incl. `ringSize` feed rules; `GET /v1/graph/:kind/:id`; dashboard Graph explorer) · ✅ **per-user anomaly detection** (`anomaly` context — Welford per-user amount baseline; `anomaly.amountZScore` feeds `r_amount_anomaly`) · ✅ API-key auth + public docs. _Deferred to later:_ signal packs |
| **v1.1** | Built to integrate | outbound webhooks · official SDKs (TS/Python) · batch & async decisions · sandbox/test mode · scoped keys + rate limits · OpenAPI spec · `GET /v1/decisions/:id`. See **Integration surfaces** below |
| **v1.2** | LLM agents (assistive) | **`agents` context**: triage agent · rule-suggester · anomaly explainer · analyst copilot. `LlmPort` adapter. **Agents propose, humans approve** |
| **v2.0** | Ecosystem & scale | extract scoring/feature-store to services · PSP/gateway connectors (Stripe/Adyen + Chapa/Telebirr) · multi-tenant & RBAC · managed feature store · streaming ingest |

## Adaptive scoring model (shipped in v1.0)

The `scoring` context now ships a second `ScorerPort` adapter, `LearnedScorer`,
selected by `SCORER=learned` (default stays `weighted`). It reads per-tag weights
from `ModelService` — a projector that remembers which tags fired for each event
(`verdict.reached`) and credits them fraud/legit when the case is resolved
(`case.resolved`). A tag keeps its hand weight until it has ≥3 labels, so a fresh
deploy behaves exactly like the weighted scorer and drifts toward the data.
The model is always projected (even under the weighted scorer) and viewable at
`GET /v1/model`; the dashboard Analytics page renders it. Same seam accepts a real
external model — swap `LearnedScorer` for an HTTP/gRPC model client, nothing upstream moves.

## Integration surfaces (v1.1) — design notes

Features that make Verdict easy for a client to adopt. Explored, not yet built;
each names the seam it grows so the modular-monolith boundaries stay intact.

- **Outbound webhooks** — let clients subscribe to `verdict.reached` / `case.resolved`
  (and future `case.opened`). A new `webhooks` context: an event subscriber + an
  HTTP-delivery adapter with HMAC-signed payloads (`X-Verdict-Signature`), at-least-once
  delivery through the existing **outbox** pattern, exponential-backoff retries, a
  dead-letter list, and a replay endpoint. Purely reactive — off the request path.
- **Batch decisions** — `POST /v1/decisions/batch` for backfills/imports: an array in,
  an array of verdicts out, each independently idempotent. Thin adapter over the existing
  `DecidePort`; cap the batch size, no new domain.
- **Async decisions** — `202 Accepted` + a callback/webhook for callers that don't want a
  synchronous wait. Same `DecidePort`, delivered over the webhooks seam.
- **Sandbox / test mode** — a `vk_test_<hex>` key class (extend `apikeys`) whose decisions
  are marked `mode:"test"`, skipped by the analytics projector and the learning model, so
  integration testing never pollutes real metrics. Or a per-request `dryRun` flag.
- **Scoped keys + rate limits** — add `scopes` (e.g. `decisions:write`, `labels:write`) and
  a per-key quota to the `apikeys` domain; the `ApiKeyGuard` enforces scope, a `RateLimiter`
  port (Redis token-bucket) enforces the quota. Backward-compatible: existing keys get a
  full scope.
- **Decision retrieval** — `GET /v1/decisions/:id` reads the append-only verdict log for
  audit/support/reconciliation (read side only; log already exists).
- **OpenAPI spec** — generate `openapi.json` from the controllers (`@nestjs/swagger`), serve
  `/openapi.json` + a docs UI, and drive the SDKs and the `verdict-ui` API reference from it
  (one source of truth).
- **Official SDKs** — thin typed clients (TS first, then Python) over the HTTP API: keys,
  retries, idempotency keys, typed verdicts, webhook-signature verification helper. Generated
  from the OpenAPI spec, published from a `sdks/` workspace.

## Production readiness (v0.9 — the gating work before "production")

Done: **rate limiting** (RATE_LIMITER port + in-memory fixed-window adapter + @RateLimit guard on `/v1/decisions` per key and `/v1/auth/login` per IP), **structured logging** (`@shared/observability/log`, JSON lines, `engine.degraded` on the fail-open path), **data erasure** (`POST /v1/privacy/erase` → graph + anomaly + replay), and a proper self-host guide (`DEPLOYMENT.md`).

Verified live against real Postgres + Redis containers:
- ✅ **Postgres proven** — `PgStore` runs and persists across restarts; pool sized (`DATABASE_POOL_MAX`, default 20); graph ring-BFS capped at 64 on the decision path.
- ✅ **Redis adapters** — idempotency, velocity feature store, rate limiter are Redis-backed behind their ports (`REDIS_URL` gates them); multi-replica now works. Rate-limiter port made async.
- ✅ **Projector race fixed** — a `Mutex` serializes the read-modify-write fold in the analytics + model projectors (the lost-update race found on live PG).
- ✅ **Load test** — ~300 decisions/s single node, p50 ~70ms / p99 ~140ms (dev laptop/Docker Desktop; DB-round-trip bound).

Still open:
- **Durable outbox** — the transactional outbox is still in-memory/per-replica; a crash between log-write and publish loses that event's projection. Move to Redis/Postgres.
- **Postgres maturity** — the `documents` jsonb store load-and-filters some reads (verdict log, replay); add typed tables / indexes / migrations for very large histories.
- **Broker event bus** — swap the in-process bus for BullMQ/Kafka for cross-process isolation + back-pressure.
- **Token lifecycle** — refresh + server-side revocation (12h expiry exists).
- **Config persistence for policies** — rules are Store-backed; the policy repo is still in-memory.

## Reserved seams (design around these now)

- **Rules Admin API** — author/version/deploy/rollback rules & policies (the
  `RulesetRepositoryPort` / `PolicyRepositoryPort` grow write + versioning sides).
- **`analytics` context** (future #9) — a read-model projector subscribing to
  `verdict.reached` + label events; never queries the write path. Powers the dashboard.
- **`agents` context** (future #8, runtime AI) — reactive: subscribes to events,
  holds an `LlmPort` + read-only tool ports into other contexts' `application/`
  surfaces. **Never** mutates a rule/policy/verdict directly; emits a
  `RuleDraft` / `CaseRecommendation` for human approval in the dashboard. Runs off
  the request path.
- **`verdict-dashboard`** — a separate authenticated Next.js app (not part of the
  public `verdict-ui` marketing site). Consumes the Rules Admin API + analytics read-model.

> Note: this `.agents/` folder is docs **for LLM coding assistants** and is
> unrelated to the runtime `agents` context above. Don't conflate them.
