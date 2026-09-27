# Verdict : Explainable Fraud & Risk Decisioning

Verdict is an open-source, self-hosted **decisioning engine**. Submit one normalized event and receive an explainable `allow`, `challenge`, `review`, or `deny` verdict — with a 0–100 score and every signal that produced it.

## Project Introduction

Verdict turns the signals you already have — the transaction, the device, the IP, whatever your enrichment provides — into a consistent, auditable, versioned decision, in a single synchronous call under 100 ms. It is deliberately a *decisioning* layer, not a data vendor: the rules, the scoring, the policy bands, the human review loop, and the record of *why* — the half most teams end up rebuilding badly — self-hosted and transparent.

Architecturally it is a **NestJS modular monolith**. Its bounded contexts communicate through typed ports and domain events, so any context can graduate into its own service without rewriting the decision domain. One core rule governs the whole system:

> **Rules propose. Scoring weighs. Decision decides.**

> ⚠️ Verdict is in **beta** (`v0.7.0`, pre-1.0). It is functional and self-hostable, but APIs, schemas, and defaults may still change between releases. Pin a version and review the changelog before upgrading.

## Updates

`v0.7.0` is the current beta. It completes the full decision loop and the operator tooling around it.

The main features of Verdict `v0.7.0`:

* **One decision API, three shapes** — synchronous `POST /v1/decisions`, **batch** (up to 100 events each scored independently), and **async** (`202` + poll `GET /v1/decisions/{id}` or receive by webhook).
* **Three scorers behind one seam** — transparent hand weights (default), an **adaptive** model that learns each signal's fraud rate from your own labels, and a **trained ML** logistic-regression scorer over the full feature vector. Switch with one env var; hot-swap the ML weights from a local file, an HTTPS URL, or S3-compatible storage — no redeploy.
* **Rich signals, computed at write time** so the request-path read stays sub-millisecond — velocity, **device fingerprinting**, **IP geolocation & impossible-travel**, an **entity graph** (fraud rings), and per-user **anomaly** z-scores.
* **The human loop** — a `review` verdict opens a **case**; analysts assign and resolve it; resolutions and PSP chargebacks become **labels** that sharpen the model, with **backtesting** before you publish a change.
* **Operable** — a transactional **outbox**, signed **webhooks**, durable & throttled **Slack / Telegram / webhook notifications**, **retention** pruning, **server-disk health**, a config-change **audit log**, **Prometheus** metrics, operator authentication and scoped **API keys**.
* **Clients** — an operator **dashboard**, a full **docs site**, official **TypeScript and Flutter SDKs**, and an **MCP server** so an LLM agent can drive the engine as tools.

Next up (`v0.8` → `1.0`): Python & React Native SDKs, typed high-volume tables, readiness probes and CI on every surface, and auth self-service — see the [Roadmap](#upcoming-roadmap).

[**Try it now →**](#installation) · [Documentation](./docs) · [Deployment guide](./DEPLOYMENT.md) · [Architecture](./ARCHITECTURE.md)

## Installation

There are two ways to run Verdict:

1. **Docker Compose** — recommended; brings up the engine, PostgreSQL, Redis, and the operator dashboard together.
2. **From source** — for local development and contributing (see [Build from source](#build-from-source)).

### Preparation

**1. Docker.** This guide doesn't cover installing Docker. Confirm it's present:

```bash
docker --version    # >= 20 ; see https://docs.docker.com/engine/install/ if missing
```

**2. A signing secret.** Verdict needs **no OpenAI or cloud key** — it runs fully offline, including the ML scorer. The one secret you supply signs operator tokens, and there is **no fallback**: the stack refuses to start until `AUTH_SECRET` is a real value. Generate one:

```bash
openssl rand -hex 32
```

### Run with Docker

```bash
git clone https://github.com/your-org/verdict-engine.git
cd verdict-engine
AUTH_SECRET=$(openssl rand -hex 32) docker compose up --build
```

This starts:

* `engine` — the decision API at `http://localhost:4000` (`/health`, `/metrics`, interactive docs at `/docs`)
* `dashboard` — the operator UI at `http://localhost:3000` (review queue, configuration, analytics)
* `db` — PostgreSQL 16 (durable) · `redis` — shared idempotency, velocity, and rate limits

Open the dashboard, create the first admin account (the first user bootstraps as admin; sign-up then closes), then **Keys → Create key** and copy the service key (shown once).

### Your first verdict

Send an event to the decision API with your key:

```bash
curl -X POST http://localhost:4000/v1/decisions \
  -H 'content-type: application/json' \
  -H 'x-api-key: vk_live_…' \
  -d '{ "type": "payment.authorize", "amount": 4900, "currency": "ETB",
        "subject": { "userId": "usr_3f9a", "channel": "telebirr",
                     "ip": "196.188.120.4", "fingerprint": "fp_9c1e77a2b4" } }'
```

You get back a verdict, a score, and the exact reasons behind it:

```json
{ "id": "vd_0mu4…", "verdict": "review", "score": 55,
  "reasons": [ { "tag": "takeover", "points": 33 }, { "tag": "no_3ds", "points": 22 } ],
  "policyVersion": "v0.4.0", "decidedAt": "2026-09-17T10:22:00.000Z" }
```

Score many events at once with `POST /v1/decisions/batch`, or off the response path with `POST /v1/decisions/async`. Prefer a client library? Use the [SDKs](#client-sdks).

## Core Concepts and Features

1. **Decision API** — one synchronous call returns a verdict (`allow` / `challenge` / `review` / `deny`), a 0–100 score, and every signal that fired. Batch and async variants share the same shape.
2. **Declarative rules** — a small, versioned DSL. A rule *proposes* weighted tags under a condition; it never decides on its own. Rules are diffable in review and hot-reloaded.
3. **Pluggable scoring** — hand weights, an adaptive learned model, or a trained ML model, behind one port — so scoring can evolve without touching the decision domain. Every verdict stays fully attributable.
4. **Signals / feature store** — velocity, device fingerprinting, IP geolocation & impossible-travel, an entity graph, and anomaly z-scores, computed at write time.
5. **Policies** — map score bands to verdicts with a `fail_open` / `fail_closed` mode for degraded dependencies; every version is retained and rollback is one click.
6. **Cases & feedback loop** — review verdicts open cases; analyst resolutions and PSP chargebacks become labels that improve the model, with backtesting before you publish.
7. **Delivery & alerts** — a transactional outbox, HMAC-signed webhooks, and durable, throttled Slack / Telegram / webhook notifications, all off the decision path.
8. **Operations** — retention pruning, server-disk health, a config-change audit log, and Prometheus metrics.
9. **Security & privacy** — operator auth (scrypt + signed bearer tokens with revocation & refresh), scoped SHA-256-hashed API keys, per-key / per-IP rate limits, BIN-only card data, and per-user right-to-erasure.
10. **Clients** — an operator dashboard, a docs site, official TypeScript & Flutter SDKs, and an MCP server for LLM agents.

## How it works

### The decision loop

```text
HTTP event
  -> Ingest normalizes and validates it
  -> Lists check block / allow / watch overrides
  -> Feature Store (velocity, device fingerprint, geolocation), Graph, and Anomaly provide features
  -> Rules propose RuleHits
  -> Scoring weighs the hits (hand weights, adaptive, or the trained ML model)
  -> Policy maps the score to a verdict
  -> Decision commits the verdict and emits events
```

Read [ARCHITECTURE.md](./ARCHITECTURE.md) for the full module and boundary contract.

### Scoring and learning

The default scorer is transparent and deterministic: `rule hits → hand-authored weights → sum → clamp to 0..100 → policy band`.

Set `SCORER=learned` for the **adaptive** scorer — deliberately small and auditable rather than a black box. A decision records the tags that fired; a case resolution or chargeback produces a `fraud`/`legit` label; each tag gets a Laplace-smoothed fraud rate scaled to points, trusted only after enough labels (until then the hand weight stands). Inspect it any time at `GET /v1/model`.

Set `SCORER=ml` for a **trained logistic-regression model** over the full feature vector, returning a calibrated probability mapped to 0–100 with the per-feature terms as the `reasons`. Inference is a single dot-product plus a sigmoid (no I/O, no model server), so it does not slow the decision path. It is trained **offline on a synthetic dataset** (`npm run train:model`); training and serving share one feature extractor so they can never drift.

The ML weights are **hot-swappable** — bundled in the image by default (works offline), or loaded and refreshed from a local file (`MODEL_PATH`), an HTTPS URL (`MODEL_URL`), or S3-compatible storage (`MODEL_S3_*`; AWS S3, MinIO, R2, Spaces — SigV4-signed, no AWS SDK). Every loaded model is validated against the feature vector, with the bundled weights as a safe fallback. Inspect the active model at `GET /v1/config/model`.

**Scaling the ML pipeline.** Serving and training scale independently. Serving is a fixed-cost dot-product held in the image, so it adds microseconds and scales horizontally with engine replicas. Training is fully decoupled: the engine only consumes a validated JSON weights file, so you can train on real labels at any scale in an external job (Python, a GBM, a feature store) and publish the weights to `MODEL_S3_*`. The label loop that sharpens the adaptive scorer is also the ML model's training set.

### Signals: geolocation, device, graph & anomaly

Two feature families feed both the rules DSL and the ML scorer, computed at write time:

- **Geolocation** — the client IP is resolved to a coarse location through the `GEO_RESOLVER` seam (offline and dependency-free by default; swap in a GeoIP database in production), yielding `geo.distanceKm`, `geo.countryChanged`, and `geo.impossibleTravel` (a move faster than a jet).
- **Device fingerprinting** — an optional `subject.fingerprint` hash yields `device.usersOnFingerprint`, `device.fingerprintFirstSeen`, and `device.fingerprintDeviceMismatch` (the same fingerprint on a different `deviceId` — a cloning/spoofing signal), independent of the client-supplied id.

The **entity graph** links users, devices, IPs and phones as they co-occur, exposing `graph.ringSize` and shared-identifier counts for rings a single event can't reveal. **Anomaly detection** keeps each user's running amount mean/variance (Welford's algorithm) and exposes `anomaly.amountZScore`; the current event is observed only after it's evaluated, so it can't influence its own baseline.

### Persistence

The application depends on the `STORE` port rather than directly on a database.

| Environment | Store | Behavior |
|---|---|---|
| `DATABASE_URL=postgres://...` | PostgreSQL | Durable production persistence |
| `PERSISTENCE=memory` | In-memory | Explicit non-persistent mode |
| Development without `DATABASE_URL` | In-memory | Convenience fallback with a warning |

PostgreSQL migrations run before the HTTP server accepts traffic. Redis is optional; with `REDIS_URL` it shares rate limits, idempotency, and velocity state across replicas. A retention job prunes the append-only collections on a timer (`RETENTION_*`), and `GET /v1/config/storage` reports the store's size, per-collection row counts, **server-disk health** per mount (`DISK_HEALTH_PATHS`), and a per-service breakdown — with matching `verdict_disk_*` Prometheus gauges.

## Client SDKs

Official client libraries wrap the API-key data plane (`decide`, `decideBatch`, `decideAsync`, `getDecision`, `recordChargeback`) with typed events/verdicts, per-request timeouts, and automatic retry with backoff:

| SDK | Package | Status |
|---|---|---|
| TypeScript / JavaScript | `@verdict/sdk` | Available |
| Dart / Flutter | `verdict_sdk` | Available |
| Python | `verdict-sdk` | Planned |
| React Native | `@verdict/react-native` | Planned |

See the [SDKs](../verdict-sdk) directory.

## Build from source

For local development and contributing (this path may hit the usual Node toolchain setup, but it's required for secondary development).

1. Install **Node.js ≥ 20** and npm.
2. Clone and install:

```bash
git clone https://github.com/your-org/verdict-engine.git
cd verdict-engine
npm install
```

3. Start in watch mode:

```bash
npm run start:dev
```

The API listens on `http://localhost:4000`. Without `DATABASE_URL`, local data is held in memory and lost when the process stops.

### Repository layout

```text
src/main.ts              HTTP bootstrap, migrations, Swagger
src/app.module.ts        composition root
src/shared/              kernel: ports, adapters, events, observability
src/contexts/            bounded contexts and their private adapters
rules/*.vd               declarative, versioned rule definitions
test/                    end-to-end and hardening tests
```

### Development commands

| Command | Purpose |
|---|---|
| `npm run start:dev` | Start NestJS in watch mode |
| `npm run type-check` | Run strict TypeScript validation |
| `npm run lint` | Run style and architecture boundary checks |
| `npm run test` | Run the Vitest suite |
| `npm run test:e2e` | Run end-to-end tests under `test/` |
| `npm run train:model` | Retrain the ML scorer on synthetic data and rewrite the weights |
| `npm run build` | Compile the production build |
| `npm run audit:ci` | Check production dependencies for high-severity issues |

Before submitting a change, run `npm run type-check`, `npm run lint`, and `npm run test`.

## Upcoming Roadmap

Delivered through `v0.7.0`: the decision API (sync/batch/async), the rules DSL, all three scorers, the full signal set (geo, device, graph, anomaly), cases + the feedback loop, outbox/webhooks/notifications, retention, audit, metrics, auth + API keys, the dashboard and docs site, and the TypeScript & Flutter SDKs.

Planned (subject to change while in beta):

* `v0.8` — Python & React Native SDKs; a readiness probe and CI on the dashboard & docs; auth self-service (password reset, MFA, account lockout).
* `v0.9` — typed high-volume tables (a normalized schema) for scale; case reassignment and re-open.
* `v1.0` — general availability: stability guarantees, hardened defaults, and optional multi-tenancy.

## Contributing

Contributions are welcome — issues, documentation, bug fixes, and new features. You can:

* Open an issue in the repository
* Submit a pull request
* Join discussions on direction and design

Please run `npm run type-check`, `npm run lint`, and `npm run test` before opening a PR. CI additionally runs `npm run audit:ci` for high-severity dependency issues.

## License

Apache-2.0.
