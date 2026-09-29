# Known limitations

Verdict is in **beta** (`v0.7.0`, pre-1.0). It is self-hostable and functional, but it has **not** had
an independent security audit or a validated production load test. This document is the honest boundary
of what the current release is and isn't, so you can evaluate it with eyes open. It is **not** yet
recommended for unsupervised production payment decisions.

## The bundled ML model is a demonstration model
`SCORER=ml` loads a logistic-regression model **trained on a synthetic dataset**, not on real fraud.
Its reported AUC measures how well it recovers that synthetic generator — it is **not evidence of
fraud-detection performance, calibration, fairness, or drift resistance**. Treat it as a reference of
the scoring *mechanism*. To make it real, **train on your own labels**: `npm run export:training-data`
builds a dataset from the fraud/legit labels you already collect joined to each decision's feature
snapshot, and `npm run train:model -- --data <file>` retrains on it (reporting PR-AUC + calibration, not
just ROC-AUC). Or supply your own model via `MODEL_PATH` / `MODEL_URL` / `MODEL_S3_*`. The default
scorer is the transparent weighted one; `ml` is opt-in.

## The geolocation resolver is synthetic by default
The default `GEO_RESOLVER` maps IPs to coarse locations **offline and deterministically** for demos and
tests — it is **not real geolocation**. Swap in a GeoIP database before relying on `geo.*` signals.

## Persistence: typed high-volume tables + a generic JSONB store
The high-volume, append-only **decision logs** — the verdict log (`verdict_log`), the API activity log
(`activity_log`) and the replay samples (`replay_log`) — live in **dedicated typed tables** with real
indexed columns (`decided_at`, `event_type`, `subject_user_id`). Their hot reads (recent decisions,
replay samples for an event type, subject data-erasure) and the retention prune run as **indexed
queries**, not full-collection scans, and each table's vacuum / index maintenance is isolated from the
others. Everything else still lives in one generic `documents(collection, id, data jsonb)` table with
expression indexes on hot paths — flexible and fast to operate at modest volume, but without typed
constraints or referential integrity, so those collections are still not tuned for high-volume
analytics. The typed tables keep the full record as `data jsonb` too, so they carry no schema-migration
cost when a record shape gains a field. Do not treat the store as a high-throughput fraud warehouse
without your own tested capacity envelope, and establish and test **backup/restore** for your
PostgreSQL instance yourself.

## What state is durable vs. cached vs. lost
| State | Where it lives | Survives restart? |
|---|---|---|
| Verdict log, activity log, replay samples, idempotency keys, outbox | PostgreSQL (`STORE`) | ✅ |
| Cases, labels, users, API keys, webhooks, notifications, audit log | PostgreSQL (`STORE`) | ✅ |
| **Policies (versions, rollback) and allow/block/watch lists** | PostgreSQL, via a write-through cache | ✅ (as of the unreleased changes) |
| Rate limits, velocity, idempotency (multi-replica) | Redis when `REDIS_URL` is set | ✅ (shared); otherwise per-process |
| Runtime settings (rate-limit / alert / retention overrides) | PostgreSQL | ✅ |
| Anomaly baselines, entity graph | PostgreSQL (`STORE`) | ✅ |
| Everything, when `PERSISTENCE=memory` or no `DATABASE_URL` | in-memory | ❌ (dev only) |

## Multi-tenancy
Every user, API key, and the decision data they produce belongs to an **org**, derived server-side from
the authenticated key/token and enforced centrally in the store — one tenant cannot read another's
verdicts, activity, replay samples, cases, labels, API keys, webhooks, notifications, or audit log.
Decisioning **config is per-org too**: each tenant has its own **policies** (band thresholds),
**rulesets**, and allow/block/watch **lists**, falling back to the built-in defaults until it publishes
its own. What is still **shared** across tenants: event **routing** (which policy id decides which event
type) and runtime **settings** (rate-limit / retention / alert thresholds) — per-org settings are a
later refinement. A single-tenant deployment runs entirely in the `default` org and is unaffected.
Cross-tenant management (`POST /v1/orgs`) is restricted to a root-org admin. This has not had a
dedicated multi-tenant security review.

## Multi-replica behavior
Redis (`REDIS_URL`) is **required** for consistent rate limits, velocity, and idempotency across
replicas; without it those are per-process. Policies and lists are served from each replica's
write-through cache loaded at boot, so a change published on one replica reaches the others on their
**next restart** — plan a rolling restart after a policy/list change in a multi-replica deployment.
Multi-replica operation is not yet load-tested.

## Delivery and eventing semantics
The transactional outbox delivers **at-least-once**; consumers must deduplicate (webhook deliveries
carry a stable id, and the decision API is idempotent via `Idempotency-Key`). The in-process event bus
is **not** a distributed broker — cross-service fan-out would require binding it to a real broker.
Webhook delivery is durable, but the **receiver's** side effects are outside Verdict's transaction.

## Operations
- `/health` is **liveness only**; use `/readyz` for readiness.
- `/metrics` is public by default — keep it on a private port / network, or set `METRICS_TOKEN` to require a bearer token.
- **Distributed tracing** is off until you set `OTEL_EXPORTER_OTLP_ENDPOINT`. When on, the request/decision path is traced over OTLP/HTTP (W3C trace-context, incoming `traceparent` honoured). Outbound webhook/notification deliveries run off the durable outbox after the request returns and are **not yet** linked into the originating trace — that propagation is planned.
- `RETENTION_VACUUM` issues a PostgreSQL `VACUUM`; confirm your managed-Postgres permissions allow it.
- The engine can only report disk health for filesystems mounted into its **own** container.

## Not included / not validated yet
Independent security review, PCI scope, a guaranteed latency SLA, high-availability failover, upgrade
/ API-compatibility guarantees, and published release artifacts. See the roadmap in the README.
