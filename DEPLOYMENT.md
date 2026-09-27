# Self-hosting Verdict

This is the operator's guide to running Verdict on your own infrastructure: what it needs,
how to configure it safely, what it does and does not yet do at scale, and how to keep it
healthy. For a one-command local demo, see [DOCKER.md](./DOCKER.md); this document is about
running it for real.

> **Maturity.** Verdict is a young, self-hostable decisioning engine. The decisioning core
> is well-tested and the seams are production-shaped, but some infrastructure adapters are
> still single-node (see [Scaling & current limits](#scaling--current-limits)). Read that
> section before putting live money-traffic behind it.

---

## 1. What you're deploying

Two processes and a database:

| Component | What it is | Needs |
|---|---|---|
| **engine** | the decisioning API (`POST /v1/decisions`, cases, config, analytics, graph, admin) | Node 20+, a Postgres URL |
| **dashboard** | the operator app (review queue, config, analytics, graph explorer) | the engine's URL |
| **PostgreSQL 16** | durable store for users, verdict log, cases, labels, API keys, graph, replay samples | a volume |

The engine is stateless *per request* but keeps some state in memory today (see limits
below). The dashboard is fully stateless.

---

## 2. Requirements

- **Docker 24+** with the Compose plugin, **or** Node 20+ and a reachable PostgreSQL 16.
- A **PostgreSQL** database you control (managed RDS/Cloud SQL/Neon or your own).
- A TLS-terminating **reverse proxy** in front of the engine and dashboard (nginx, Caddy,
  a cloud load balancer). The engine speaks plain HTTP; **never expose it to the internet
  without TLS in front.**

---

## 3. Configuration (environment variables)

The engine **validates its environment at boot and refuses to start** if production
requirements are missing — you get a clear error and a non-zero exit, never a silently
insecure process.

| Variable | Service | Required | Default | Purpose |
|---|---|---|---|---|
| `NODE_ENV` | engine | — | `development` | Set to `production` to enable strict validation below. |
| `AUTH_SECRET` | engine | **prod** | — (no fallback) | HMAC key that signs operator tokens. Must be ≥16 chars; placeholders (the old compose default, repeated-char filler) are rejected. Generate: `openssl rand -hex 32`. Rotating it invalidates all sessions. |
| `DATABASE_URL` | engine | **prod** | — | `postgres://user:pass@host:5432/verdict`. Required in production unless you opt out with `PERSISTENCE=memory`. |
| `DATABASE_POOL_MAX` | engine | — | `20` | Max Postgres connections per replica. Each decision makes several round-trips, so raise this if decisions queue under load. |
| `REDIS_URL` | engine | — | — | `redis://host:6379`. Shares idempotency, velocity counters and rate limits across replicas. **Required to run more than one engine replica.** Unset = per-replica (single-node). |
| `PERSISTENCE` | engine | — | auto | Set to `memory` to **explicitly** accept a non-persistent deploy (data lost on restart). Only for demos. |
| `PORT` | engine | — | `4000` | HTTP port. |
| `SCORER` | engine | — | `weighted` | `weighted` (hand weights), `learned` (adaptive model trained from your labels), or `ml` (trained logistic-regression model over the full feature vector; weights committed at `src/contexts/scoring/model/`, retrain with `npm run train:model`). All implement the same port. |
| `MODEL_SOURCE` | engine | — | auto | Where the ML model's weights come from: `bundled` (default), `disk`, `url`, or `s3`. If unset it's inferred from what you configure (S3 → disk → URL → bundled). Only used when `SCORER=ml`; a source that fails to load/validate falls back to the bundled weights. |
| `MODEL_PATH` | engine | — | — | **Disk source.** Path to a local JSON weights file (a mounted volume / ConfigMap), e.g. `/models/verdict-weights.json`. |
| `MODEL_URL` | engine | — | — | **URL source.** HTTPS URL to the weights — a CDN or a presigned object. |
| `MODEL_S3_ENDPOINT` / `MODEL_S3_REGION` | engine | — | — / `us-east-1` | **S3 source.** Endpoint of the S3-compatible store (`https://s3.amazonaws.com`, or a MinIO/R2/Spaces URL) and its region. |
| `MODEL_S3_BUCKET` / `MODEL_S3_KEY` | engine | — | — | Bucket and object key of the weights file. |
| `MODEL_S3_ACCESS_KEY_ID` / `MODEL_S3_SECRET_ACCESS_KEY` | engine | — | — | S3 credentials (SigV4-signed GET, no SDK). Read from env, never logged. |
| `MODEL_REFRESH_MINUTES` | engine | — | `0` (load once) | How often to re-load the model source, so a new model rolls out live. `0` loads once at boot. |
| `MODEL_FETCH_TIMEOUT_MS` | engine | — | `5000` | Timeout for a URL/S3 model fetch. |
| `RATE_LIMIT_DECISIONS_PER_MIN` | engine | — | `600` | Per-API-key budget for `POST /v1/decisions`. The startup **default** — an admin can override it at runtime from the dashboard (Configure → Rate limits) or `PUT /v1/config/rate-limits`, no redeploy. |
| `RATE_LIMIT_LOGIN_PER_MIN` | engine | — | `10` | Per-IP budget for `POST /v1/auth/login` (brute-force brake). Runtime-overridable like the above. |
| `TRUST_PROXY` | engine | — | `false` (trust none) | Proxy hops to trust for the real client IP. Default ignores `X-Forwarded-For` so it can't be spoofed; behind one proxy/LB set `1`, behind two set `2`. Wrong value = per-IP limits key on the proxy's IP or a spoofable header. |
| `AUTH_SECRET_PREVIOUS` | engine | — | — | Previous signing secret(s), comma-separated, kept valid during an `AUTH_SECRET` rotation (see §6b). Their tokens verify until they expire; remove once aged out. |
| `AUTH_ISSUER` / `AUTH_AUDIENCE` | engine | — | `verdict-engine` / `verdict-operators` | Claims pinned into operator tokens and checked on verify. Change only if you run multiple isolated issuers. |
| `RETENTION_SWEEP_MINUTES` | engine | — | `60` | How often the retention prune job runs. |
| `RETENTION_VERDICTS_DAYS` | engine | — | `365` | Days to keep the append-only verdict log. `0` = keep forever. Runtime-overridable (Configure → Retention or `PUT /v1/config/retention`). |
| `RETENTION_ACTIVITY_DAYS` | engine | — | `90` | Days to keep the API activity log. `0` = forever. Runtime-overridable. |
| `RETENTION_REPLAY_DAYS` | engine | — | `90` | Days to keep replay samples (the largest slice — whole events, for backtesting). `0` = forever. Runtime-overridable. |
| `RETENTION_IDEMPOTENCY_DAYS` | engine | — | `7` | Days to keep idempotency keys (only need to outlive client retries). `0` = forever. Runtime-overridable. |
| `RETENTION_DEAD_LETTER_DAYS` | engine | — | `30` | Days to keep dead-lettered outbox rows. `0` = forever. Runtime-overridable. |
| `NOTIFY_THROTTLE_PER_MIN` | engine | — | `60` | Default cap on alerts delivered to a single channel per minute (excess is dropped, not queued). `0` = unlimited. A channel can override it at registration. |
| `RETENTION_VACUUM` | engine | — | `false` | When `true`, run a (non-locking) `VACUUM` after a prune sweep that deleted rows, returning dead space for reuse promptly. Autovacuum handles this otherwise; enable if you prune large volumes and want space reclaimed sooner. |
| `DISK_HEALTH_PATHS` | engine | — | container fs + model volume | Comma-separated filesystem paths whose disk health (`total`/`free`/`used`) is reported at `GET /v1/config/storage` and in the `verdict_disk_*` metrics. Only filesystems mounted into the engine's own container are visible; bind-mount a sibling volume (read-only) to watch it. See §9. |
| `VERDICT_API_URL` | dashboard | yes | `http://engine:4000` | Where the dashboard reaches the engine (server-side; no CORS). |

**Production boot fails** unless `AUTH_SECRET` is a real secret and `DATABASE_URL` is a
`postgres://` URL (or you set `PERSISTENCE=memory`). Verify before shipping:

```bash
NODE_ENV=production node dist/main.js   # exits 1 and prints exactly what's missing
```

---

## 4. Deploy with Docker Compose

From `verdict-engine/`, with `verdict-dashboard/` checked out beside it:

```bash
AUTH_SECRET=$(openssl rand -hex 32) docker compose up --build -d
```

Compose starts Postgres (with a healthcheck and the `verdict-db` volume), the engine
(wired to that database), and the dashboard. See [DOCKER.md](./DOCKER.md) for the service
map and per-image builds. For a real deployment, put the compose stack (or the two images)
behind your reverse proxy and point `DATABASE_URL` at your managed Postgres instead of the
bundled `db` service.

---

## 5. First run — bootstrap the admin

Registration is **closed after the first account**. On a fresh database:

1. Open the dashboard. It detects an empty system (`GET /v1/auth/status → needsBootstrap`)
   and shows "Create the admin account".
2. Create it — the first user becomes `admin`. Every later `POST /v1/auth/register` returns
   `403 REGISTRATION_CLOSED`.
3. As admin, add analysts (**Team**) and mint service API keys (**Keys**) — keys are shown
   **once**, stored SHA-256-hashed, and revocable.

Callers send decisions with `X-API-Key: vk_live_…`. Operators use bearer tokens (12-hour
expiry) from login.

---

## 6. Security checklist

- [ ] `AUTH_SECRET` is a unique 32-byte random value, stored in a secrets manager — not in
      the compose file or git.
- [ ] TLS terminates at a reverse proxy; the engine port is not publicly exposed.
- [ ] `DATABASE_URL` uses a least-privilege Postgres role and TLS (`sslmode=require`).
- [ ] `TRUST_PROXY` matches your topology (e.g. `1` behind a single LB) so per-IP login limits
      key on the real caller and `X-Forwarded-For` can't be spoofed. Leave it unset if the engine
      is not behind a proxy.
- [ ] API keys are scoped to services, rotated periodically, and revoked when leaked.
- [ ] `AUTH_SECRET` rotation uses the zero-downtime procedure in §6b (via `AUTH_SECRET_PREVIOUS`),
      not a hard swap.
- [ ] Operators can end a session: `POST /v1/auth/logout` (this token) and `POST /v1/auth/logout-all`
      (every session for the user) revoke immediately; `POST /v1/auth/refresh` slides a session.
- [ ] `DATABASE_URL` uses a **least-privilege** Postgres role: it needs `CONNECT`, `USAGE` on the
      schema, and `SELECT/INSERT/UPDATE/DELETE` on the app tables (the engine runs its own
      migrations, so grant `CREATE` only during a migration window or run migrations as a
      separate owner role). It does not need superuser.
- [ ] `/metrics` and the engine port are reachable only from your monitoring and proxy, never
      the public internet.
- [ ] Rate limits are tuned to your capacity (`RATE_LIMIT_*`).
- [ ] `npm run audit:ci` is green (the CI workflow in `.github/workflows/ci.yml` runs it, plus
      type-check and tests, on every push/PR).
- [ ] Only the dashboard and trusted services can reach the engine (network policy / SG).

Built in already: scrypt password hashing, HMAC bearer tokens with expiry, SHA-256-hashed
API keys, admin/analyst roles, per-case ownership, no PANs stored (BIN only), an append-only
verdict log, HMAC-signed webhook deliveries, PII masking in the activity log, and
fail-open/fail-closed policy control per event type.

---

## 6a. Requirements & capacity

Verdict is light to run — the engine is IO-bound and the dashboard is stateless. Postgres is
the component you size for growth.

| Component | Recommended (to start) | Notes |
|---|---|---|
| **Engine** (per replica) | 1–2 vCPU, 1 GB | Stateless behind Postgres; mostly waiting on the DB. |
| **Dashboard** | 0.5 vCPU, 512 MB | One instance suffices for an ops team. |
| **PostgreSQL 16** | 2 vCPU, 4 GB, SSD | System of record. Fast disk + backups + room to grow. |

**Measured throughput.** A single engine replica sustained **~300 decisions/second** in a
benchmark on a dev laptop with Postgres over Docker Desktop — a deliberately pessimistic
setup for DB round-trip latency. Latency was **~20 ms** for a lone request and **p50 ~70 ms /
p99 ~140 ms** under moderate concurrency, with zero errors up to 64 requests in flight. A
tuned Linux host with Postgres on a low-latency network will do materially better. Treat these
as a floor, and run your own benchmark for an SLA — throughput is bound by **database latency**,
not CPU, because each decision makes several round-trips (velocity, graph, anomaly, policy, then
the log/outbox writes).

**Two levers** raise it: keep Postgres close and size `DATABASE_POOL_MAX` to your concurrency;
and set `REDIS_URL` so the hot velocity reads and idempotency go to Redis, which also lets you
**scale out horizontally** — several engine replicas behind a load balancer sharing one budget.

**Storage sizing.** Budget ~3 rows per decision (verdict log + replay sample + scoring sample)
plus a graph node per new entity — order of a few GB per million decisions. The replay log is
the largest slice; the retention job below ages it out (§6c).

## 6c. Data retention & pruning

The append-only collections (verdict log, activity log, replay samples, idempotency keys,
dead-lettered outbox rows) grow with traffic. A built-in prune job bounds them: on a timer
(`RETENTION_SWEEP_MINUTES`, default 60) it deletes rows older than each collection's window. On
Postgres this is an indexed range delete (migration `004`), so it never loads a collection to age
it out. Defaults: verdicts 365d, activity 90d, replay 90d, idempotency 7d, dead-letter 30d; a
window of `0` keeps that collection **forever** (e.g. set `RETENTION_VERDICTS_DAYS=0` if your
audit policy requires an unbounded verdict log — then archive it out-of-band).

Tune windows per deployment via the `RETENTION_*` env vars (§3), or at runtime with no redeploy
from the dashboard (**Configure → Retention**) or the admin API:

```bash
curl -X PUT  $ENGINE/v1/config/retention -H "Authorization: Bearer $TOKEN" \
     -H 'content-type: application/json' -d '{"activity":120,"idempotency":3}'
curl -X POST $ENGINE/v1/config/retention/run -H "Authorization: Bearer $TOKEN"   # sweep now
```

Pruned counts are exported as `verdict_retention_pruned_total{collection=…}` and the last sweep
time as `verdict_retention_last_run_timestamp_seconds` — alert if that timestamp goes stale.

## 6b. Rotating the signing secret (zero-downtime)

Operator tokens are HMAC-signed and carry a key id (`kid`), so you can rotate `AUTH_SECRET`
without logging everyone out:

1. Generate a new secret: `openssl rand -hex 32`.
2. Move the **current** secret to `AUTH_SECRET_PREVIOUS` and set the **new** one as `AUTH_SECRET`,
   then roll the engine. New tokens sign with the new key; tokens already held keep verifying
   against the previous key.
3. After the token TTL has elapsed (12h), remove `AUTH_SECRET_PREVIOUS` and roll again. The old
   key is now fully retired.

To force everyone out immediately instead, drop `AUTH_SECRET_PREVIOUS` in step 2 — a hard swap
invalidates every live session (operators just log in again). Individual sessions can be ended
any time with `POST /v1/auth/logout` / `logout-all`.

---

## 7. Scaling & current limits

**Multi-replica.** Set `REDIS_URL` and you can run **several engine replicas** behind a load
balancer: velocity counters and rate limits are shared in Redis, and idempotency + the outbox are
shared in Postgres, so a retry or a burst is enforced consistently no matter which replica it hits.
Postgres and the dashboard already scale out. Without `REDIS_URL`, velocity/rate-limits are
per-process — **run a single replica** (idempotency and the outbox are still safe via Postgres).

Remaining sharp edges to know about:

- **Atomic idempotency.** The idempotency record is claimed with an atomic insert-if-absent and
  written **inside the verdict's transaction**, so a crash after commit or a concurrent duplicate
  can never produce two verdicts/events for one key (verified: 10 concurrent duplicates → 1 commit).
  A concurrent duplicate still does its pre-commit feature/graph observes (velocity slightly
  over-counts — conservative for fraud). Records are aged out by the retention job (§6c).
- **Durable transactional outbox, cross-replica.** Verdict + activity + replay + outbox event commit
  in one Postgres transaction; a relay delivers at-least-once with backoff and a dead-letter (a
  crash re-delivers on restart). Each row is **leased** (atomic per-row lock, 30s) so multiple
  replicas don't process it at once; consumers still dedupe on `event.id`. A cross-process broker is
  the longer-term swap.
- **In-process event bus:** projectors (analytics, the learned model) run in-process with
  concurrent fan-out; folds are serialized per projector so updates aren't lost, but a broker
  (Kafka/BullMQ) is the planned swap for cross-process isolation and back-pressure.
- **Document-store model.** The Postgres adapter stores documents in a `jsonb` table with explicit
  migrations (`schema_migrations`, applied at boot) and partial expression indexes for the hot paths.
  Graph writes use a striped in-process lock to avoid lost updates. This is deliberately flexible;
  **for very large histories / heavy reporting, move the high-volume collections to typed tables**
  (verdicts, cases, labels, replay) — the migration framework is in place for it. The graph's ring
  walk is bounded (64 nodes on the decision path).
- **Webhook delivery is durable too:** each (endpoint, event) is a persisted row retried with
  backoff and dead-lettered after 8 attempts; inspect and re-drive via `GET /v1/webhooks/deliveries`
  and `POST /v1/webhooks/deliveries/redrive` (admin).
- **Benchmark your own SLA:** the measured numbers in §6a are a floor on modest hardware, not a
  guaranteed SLA — run a load test against your infrastructure.
- **Failure behaviour is tested.** An automated failure-injection suite
  (`failure-injection.spec.ts`) exercises the crash-safety contract directly: concurrent duplicate
  idempotency keys → one commit, a crash after the verdict commits but before delivery → a restarted
  relay re-delivers exactly once, a database outage at commit → no partial write and no verdict
  returned, a dead feature store → a degraded decision that still records, and a delivery storm →
  events parked in the dead-letter without ever throwing.

---

## 8. Data governance

- **Right to erasure:** `POST /v1/privacy/erase { "userId": "…" }` (admin) removes a user's
  graph identity, learned spending baseline, and stored replay samples (which contain whole
  events). The append-only verdict log is out of scope by design — it holds only an event
  id, verdict and tags — and is aged out by the retention job (§6c).
- **What's stored:** identifiers you send (user/device/ip), event attributes, verdicts and
  the tags behind them. **Never send full PANs** — the engine expects a BIN only.
- **Backups:** back up the Postgres volume/instance on your normal schedule; that is the
  system of record. The dashboard holds no data.

---

## 9. Observability & operations

- **Health:** `GET /health` (public) → `{ status, name, version }` for liveness/readiness
  probes.
- **Metrics:** `GET /metrics` (public, Prometheus text format — keep it on the private port).
  Exposes decision latency (`verdict_decision_duration_ms`), decisions by verdict
  (`verdict_decisions_total`), degraded decisions, `429`s (`verdict_rate_limited_total`), and
  outbox/webhook delivery counters + pending-depth gauges (`verdict_outbox_*`, `verdict_webhook_*`).
  Alert on a rising `verdict_degraded_total`, non-zero `*_dead_lettered_total`, or a growing
  `*_pending` gauge.
- **Dead-letters:** drained events that exhausted their retries land in the `outbox_dead` /
  `webhook-deliveries-dead` collections; re-drive webhooks via `POST /v1/webhooks/deliveries/redrive`.
- **Alerting:** add a Slack incoming-webhook, a Telegram bot (`url` =
  `https://api.telegram.org/bot<token>/sendMessage`, `target` = chat id), or a generic HTTPS channel
  under `POST /v1/notifications` to get pinged on events — `verdict.reached` (at/above a severity),
  `case.resolved`, `alert.anomaly` (amount far from the user's baseline; tune the z-score threshold
  at `PUT /v1/config/alerts` or Configure → Anomaly alerts, default 3σ), and `alert.dead_letter`
  (a delivery gave up). Delivery is **durable** (queued, retried with backoff, dead-lettered — inspect
  and re-drive via `GET`/`POST /v1/notifications/deliveries[/redrive]`) and **throttled per channel**
  (`throttlePerMin`, default `NOTIFY_THROTTLE_PER_MIN`) so an alert storm can't bury an operator or
  trip your Slack's rate limit. It all runs off the decision path.
- **Config-change audit log:** every operator mutation (a settings/retention change, a published
  policy, a new alert channel or API key) is recorded — actor, action, time, result, with secret-ish
  request fields redacted — at `GET /v1/audit` (admin). Answers "who changed this, when?" without
  relying on the app logs being retained.
- **ML scorer:** with `SCORER=ml`, decisions score against a logistic-regression model trained
  **offline on synthetic data** (`npm run train:model` regenerates the committed weights). Inference is
  an in-process dot-product — no model server, no added decision latency — and the score stays
  explainable via per-feature `reasons`. Geolocation (`GEO_RESOLVER` — swap the offline resolver for a
  GeoIP database in production) and device fingerprinting feed both this model and the rules DSL. The
  weights are **hot-swappable** and can be loaded from a **local file** (`MODEL_PATH`), an **HTTPS URL**
  (`MODEL_URL`), or **S3-compatible object storage** (`MODEL_S3_*` — AWS S3, MinIO, R2, Spaces; SigV4-signed,
  no SDK), refreshed on `MODEL_REFRESH_MINUTES` — each validated against the feature vector, with the
  bundled weights as the fallback — so you retrain and roll out without a redeploy. See the active model,
  its source and per-feature weights at `GET /v1/config/model` (or Configure → Scoring model);
  `verdict_model_remote_active` is `1` while a remotely-loaded model is serving.
- **Disk management:** `GET /v1/config/storage` (admin) reports the document store's size on disk and
  per-collection row counts; the same is sampled into `verdict_storage_bytes` and
  `verdict_storage_rows{collection}` every retention sweep, so you can see what's growing and tune the
  windows (§6c). Retention deletes bound growth; set `RETENTION_VACUUM=true` to reclaim the freed space
  promptly rather than waiting on autovacuum.
- **Server disk health:** the same endpoint (and the dashboard's Storage panel) also reports the
  **filesystem** health of the disks data lives on — `{ path, totalBytes, freeBytes, usedBytes,
  usedPercent }` per mount — plus a **per-service breakdown** (`components`) of what's consuming the
  disk (the document store, and a disk-backed model file). Set `DISK_HEALTH_PATHS` (comma-separated) to
  the volume mounts to watch; unset, it reports the container filesystem and, when `MODEL_PATH` is set,
  the model volume. The engine can only see filesystems **mounted into its own container** — to watch
  the Postgres volume from here, bind-mount it read-only into the engine (an example is commented in
  `docker-compose.yml`); otherwise monitor the database container's own volume with node_exporter or
  cAdvisor. Exported for alerting as `verdict_disk_total_bytes{path}`, `verdict_disk_free_bytes{path}`,
  `verdict_disk_used_ratio{path}`, and `verdict_disk_component_bytes{component}`.
- **Structured logs:** the engine emits one JSON line per operational event
  (`{ ts, level, event, … }`) to stdout/stderr with sensitive keys redacted — ship these to
  your log stack. Notably, a degraded decision (a dependency threw and the policy's
  `onError` took over) logs `event: "engine.degraded"` with the scrubbed cause.
- **Upgrades:** rebuild the image, roll the engine, then the dashboard. The verdict log is
  append-only and policies are versioned, so a bad config rolls back via the dashboard
  (Configure → version history) without redeploying.

---

## 10. Where to go next

- API reference with every field: the dashboard **Docs** tab and the public
  `/api-reference` page.
- Extending the engine (new rules, contexts, adapters): `.agents/` in this repo.
