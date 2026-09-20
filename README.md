# Verdict Engine

Open-source fraud & risk **decisioning** engine. Score every event against rules
you can read and return `allow` / `challenge` / `review` / `deny` in under 100ms —
a modular monolith you can split into services the day you outgrow it.

> **Status:** `v0.7.0`, green (boundary lint · type-check · unit + e2e tests · dep audit).
> The decision loop runs end to end on Postgres + Redis (or in-memory for dev), with weighted
> and adaptive scoring, a step-up `challenge` outcome, block/allow/watch lists, versioned
> policies + rollback, an entity graph, per-user anomaly detection, cases + feedback, analytics,
> a durable transactional outbox, HMAC webhooks, Slack/Telegram/webhook alert notifications,
> Prometheus `/metrics`, operator auth with rotation + revocation, and scoped API keys.
> Production hardening is ongoing — see [DEPLOYMENT.md](./DEPLOYMENT.md) for current limits.

## Quick start

```bash
npm install
npm run start:dev        # http://localhost:4000
```

Or run the engine **and** the operator dashboard together with Docker — see
[DOCKER.md](./DOCKER.md) (`docker compose up --build`).

```bash
curl -X POST http://localhost:4000/v1/decisions \
  -H 'content-type: application/json' \
  -d '{ "type": "payment.authorize", "amount": 4900, "currency": "ETB",
        "subject": { "userId": "usr_3f9a", "channel": "telebirr" } }'
```

## Layout

```
src/shared/       kernel: EventBus · Clock · Result · DomainEvent   (nothing business here)
src/contexts/     ingest · feature-store · rules · scoring · decision · cases · feedback
rules/*.vd        the declarative rule DSL, versioned in git
```

Read [ARCHITECTURE.md](./ARCHITECTURE.md) first — it is the contract the code follows.

## Commands

| | |
|---|---|
| `npm run start:dev` | run with watch |
| `npm run type-check` | `tsc --noEmit` |
| `npm run lint` | boundary + style rules (`eslint-plugin-boundaries`) |
| `npm run test` | vitest |

Apache-2.0.
