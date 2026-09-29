# Changelog

All notable changes to Verdict Engine are documented here. The format follows
[Keep a Changelog](https://keepachangelog.com/en/1.1.0/), and the project aims to follow
[Semantic Versioning](https://semver.org/spec/v2.0.0.html) once it reaches 1.0. While in `0.x`
(beta), minor versions may include breaking changes — pin a version and read this file before upgrading.

## [Unreleased]

### Added
- **Multi-tenancy (org isolation at the store seam).** Every user, API key, and the decision data they
  produce belongs to an org. A request's tenant is derived server-side from the authenticated API key
  or operator token (never spoofable from the client) and carried on an `AsyncLocalStorage`, so the
  store scopes reads/writes to that org centrally — one tenant can never read another's verdicts,
  activity, replay samples, cases, labels, API keys, webhooks, notifications, or audit log. The
  `documents` primary key gains `org_id` so per-org state (e.g. an `Idempotency-Key`) can't collide
  across tenants; typed tables add an `org_id` scoping column and index. Provision a tenant with
  `POST /v1/orgs` (root-org admin only), which creates the org and its first admin in one step; existing
  single-tenant deployments run entirely in the `default` org with no behavior change. Background work
  (retention, the outbox/webhook/notification relays) runs across all orgs; the config plane (policies,
  rules, lists, settings) is shared for now (per-org config is a planned follow-up). Verified with an
  end-to-end isolation test (two orgs, no cross-visibility, non-root provisioning forbidden) and against
  PostgreSQL 16 (composite PK, per-org idempotency, SQL-level scoping).
- **Per-org decisioning config.** Each tenant now has its own **policies** (band thresholds),
  **rulesets**, and allow/block/watch **lists**, falling back to the built-in defaults until it
  publishes its own — one org's threshold change or block never affects another. The write-through
  caches became org-keyed with a shared-seed fallback; event routing and runtime settings stay
  deployment-wide for now. Covered by per-org isolation tests (a published policy override and a block
  list stay private to the publishing org, across a restart).
- **Distributed tracing (OpenTelemetry, dependency-free).** Set `OTEL_EXPORTER_OTLP_ENDPOINT` to a
  collector and the engine emits W3C-trace-context spans over OTLP/HTTP (JSON) — no `@opentelemetry/*`
  agent, mirroring the dep-free metrics registry. Each request opens a server span and the decision
  path nests child spans under it (`decision.decide` → `feature-store.snapshot`, `graph.features`,
  `anomaly.features`, `rules.evaluate`, `scorer.score`, `decision.commit`), carried through the async
  call chain by `AsyncLocalStorage`. An incoming `traceparent` is honoured (traces link to the caller)
  and every response returns one. `TRACE_SAMPLE_RATIO` head-samples; `verdict_trace_spans_exported_total`
  reports exporter health. Off by default (zero overhead until an endpoint is set). Validated end-to-end
  (middleware → Nest → nested decision spans → OTLP export) and with W3C parse/format + payload-shape
  unit tests.
- **Typed high-volume tables for the decision logs.** The append-only verdict log, API activity log
  and replay samples now live in dedicated tables (`verdict_log`, `activity_log`, `replay_log`) with
  real indexed columns (`decided_at`, `event_type`, `subject_user_id`) instead of the shared JSONB
  `documents` table. Recent-decision reads, per-type replay lookups, subject data-erasure and the
  retention prune are now **indexed queries** rather than full-collection scans loaded into memory,
  and each table's vacuum/index maintenance is isolated. The store gained a query-pushdown seam
  (`Collection.query` / `deleteWhere`) that the Postgres adapter maps to typed columns and the memory
  adapter serves in-process, so the change is transparent to callers. A migration backfills existing
  history into the new tables and drops the now-redundant JSONB partial indexes; the full record is
  still kept as `data jsonb`, so a record gaining a field needs no schema change. Validated end-to-end
  against PostgreSQL 16 (indexed `ORDER BY decided_at DESC`, backfill, idempotent re-run), and the
  Postgres integration CI job now reads a decision back from the typed table.
- **Durable policies and lists.** Published policy versions, rollbacks, and allow/block/watch list
  entries are now persisted to the store and survive a restart (previously process-local). Reads stay
  on a write-through in-memory cache, so the decision path takes no extra database round-trip.
  Covered by persistence-across-restart tests.
- **Optional `/metrics` authentication.** Set `METRICS_TOKEN` to require `Authorization: Bearer <token>`
  (or `X-Metrics-Token`) on the metrics endpoint; unset keeps it public (the prior default).
- **Postgres + Redis integration CI job** that boots the engine in production mode against real
  PostgreSQL and Redis and drives a decision end-to-end (exercising migrations, the Postgres store,
  Redis wiring, and the decision path). CI also now runs the production build and a Docker image build.
- **Readiness probe** at `GET /readyz`, distinct from the liveness `GET /health`: verifies the
  datastore (and Redis when configured) are reachable, returning `503` until the instance can serve
  durable decisions. Use it as the orchestrator/load-balancer readiness signal.
- `KNOWN-LIMITATIONS.md` documenting the current beta boundaries (generic JSONB store, synthetic ML
  and geo, in-process event bus, single-node defaults, and what state is durable vs. cached).
- A version drift-guard test so `APP_VERSION` and `package.json` can't diverge.

### Changed
- The bundled ML model is now labelled explicitly as a **demonstration / reference model** (trained on
  synthetic data), in the README and at `GET /v1/config/model`, to prevent it being mistaken for a
  production-trained fraud model.

### ML pipeline
- **Train the ML scorer on real labels.** `npm run export:training-data` builds a labelled dataset by
  joining fraud/legit labels to the feature snapshot each decision was made from (the replay log), and
  `npm run train:model -- --data <file>` trains on it — using the *same* feature extractor the engine
  serves with, so training can't drift from serving.
- The trainer now reports **PR-AUC, Brier score and a calibration (reliability) table** alongside
  ROC-AUC, and warns when a real model's AUC is too low to trust — so a model can be judged at its
  operating point, not just on ROC-AUC.

### CI
- Added a **CI workflow to the operator dashboard** (lint / type-check / test / build). The docs site
  already runs the same gate in its Pages deploy workflow.

### Fixed
- Documentation placeholders: repository clone URLs and the security contact.

## [0.7.0] — 2026-09

First public beta. Decisioning (sync / batch / async), declarative rules, weighted / adaptive /
trained-ML scoring, velocity + device fingerprinting + IP geolocation + entity graph + anomaly
signals, cases and the feedback loop, transactional outbox, signed webhooks, durable & throttled
notifications, retention pruning, server-disk health, a config-change audit log, Prometheus metrics,
operator auth and scoped API keys, an operator dashboard, a docs site, and TypeScript & Flutter SDKs.
