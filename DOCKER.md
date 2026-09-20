# Docker setup

Run the Verdict engine and the operator dashboard together with one command.

## Prerequisites

- Docker 24+ with the Compose plugin (`docker compose version`).
- This repo (`verdict-engine`) and `verdict-dashboard` checked out **side by side**
  — the compose file builds the dashboard from `../verdict-dashboard`.

```
Files/
├─ verdict-engine/      ← run compose from here
└─ verdict-dashboard/
```

## Quick start

From `verdict-engine/`:

```bash
docker compose up --build
```

That builds two images and starts:

| Service | URL | What it is |
|---|---|---|
| `engine` | http://localhost:4000 | the decisioning API (`POST /v1/decisions`, cases, labels) |
| `dashboard` | http://localhost:3000 | the operator review queue |

The dashboard reaches the engine over the compose network at `http://engine:4000`
(set via `VERDICT_API_URL`), so no CORS and nothing to configure.

Stop with `Ctrl+C`, or `docker compose down`.

## Try it

```bash
curl -X POST http://localhost:4000/v1/decisions \
  -H 'content-type: application/json' \
  -d '{ "type": "card.authorize", "amount": 3500, "currency": "USD",
        "subject": { "userId": "usr_1", "deviceId": "dev_1", "channel": "visa" },
        "instrument": { "kind": "card", "threeDS": false } }'
```

Then open the dashboard — a `review` decision shows up in the queue.

## Building one image at a time

```bash
# engine only
docker build -t verdict-engine:0.7 .
docker run -p 4000:4000 verdict-engine:0.7

# dashboard only (point it at a running engine)
docker build -t verdict-dashboard:0.7 ../verdict-dashboard
docker run -p 3000:3000 -e VERDICT_API_URL=http://host.docker.internal:4000 verdict-dashboard:0.7
```

## Environment

| Variable | Service | Default | Purpose |
|---|---|---|---|
| `PORT` | engine | `4000` | HTTP port |
| `VERDICT_API_URL` | dashboard | `http://engine:4000` | where the dashboard reads the engine |

## Persistence & auth

- **Durable data** (users, verdict log, cases, labels) is stored in **PostgreSQL**
  (the `db` service), on the `verdict-db` volume — so it survives `docker compose
  down && up`. The engine reads `DATABASE_URL` and goes through the `Store` port
  (`PgStore`); nothing above the port knows it's a database. Cache-like state
  (feature velocity counters, idempotency keys) is in-memory by design and resets
  on restart — that's where Redis goes later, behind its own port.
- Running the engine **without** Docker and without a `DATABASE_URL` falls back to
  an in-memory store (non-persistent) and logs a warning; set `DATABASE_URL` to a
  Postgres instance to persist.
- **Set `AUTH_SECRET`** in production (it signs operator tokens):
  `AUTH_SECRET=$(openssl rand -hex 32) docker compose up --build`.
- The first operator registers through the dashboard onboarding (email + password,
  scrypt-hashed). Case actions require a valid token.

## Notes

- The engine image is a multi-stage build (compile, then a slim runtime with prod
  deps only); the dashboard uses Next.js `standalone` output.
