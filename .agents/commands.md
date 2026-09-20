# Commands

| Command | What it does | When |
|---|---|---|
| `npm install` | install deps | first time |
| `npm run start:dev` | run with watch → `http://localhost:4000` | local dev |
| `npm run start` | run once | — |
| `npm run type-check` | `tsc --noEmit` (strict) | **after any non-trivial change** |
| `npm run lint` | ESLint incl. boundary rules | before finishing |
| `npm run test` | vitest | when logic changes |
| `npm run build` | `nest build` → `dist/` | prod build |

## The verification bar before you say "done"

1. `npm run type-check` — clean.
2. `npm run lint` — clean (this is where a boundary violation shows up).
3. No breaking change to a published port or event name.

## Try the endpoint

```bash
curl -X POST http://localhost:4000/v1/decisions \
  -H 'content-type: application/json' \
  -d '{ "type": "payment.authorize", "amount": 4900, "currency": "ETB",
        "subject": { "userId": "usr_3f9a", "channel": "telebirr" } }'
```

> Status note: **v0.4 is implemented** and runs on in-memory adapters (no Redis/SQL
> needed for local dev/tests). `npm run test` covers unit + e2e; `npm run lint`
> enforces the context boundaries. See [`roadmap.md`](./roadmap.md).
