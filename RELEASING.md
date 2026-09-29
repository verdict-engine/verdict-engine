# Releasing

Verdict is in `0.x` beta; releases are cut manually. This checklist keeps a release safe and
reproducible until release automation lands.

## Pre-release checks
- [ ] `npm run type-check`, `npm run lint`, `npm test`, `npm run build`, `npm run audit:ci` all pass (CI covers these).
- [ ] `docker build .` succeeds (CI covers this).
- [ ] Bump `version` in `package.json` **and** `APP_VERSION` in `src/version.ts` (the `version.spec.ts` guard fails if they drift).
- [ ] Update `CHANGELOG.md`: move `Unreleased` items under the new version + date.
- [ ] Review `KNOWN-LIMITATIONS.md` — is anything no longer a limitation, or newly one?

## Migrations & data
- [ ] Any new migration in `src/shared/migrations/` is **additive and idempotent**, and runs before the server serves traffic (it does — `main.ts` runs migrations pre-listen).
- [ ] Confirm a **backup** of the target PostgreSQL exists before deploying a release with a migration.
- [ ] Verify `/readyz` returns 200 on a canary before shifting traffic (it checks store + Redis reachability).

## Secrets & config
- [ ] `AUTH_SECRET` is a real secret in the target environment (the engine refuses to boot otherwise).
- [ ] `DATABASE_URL` (and `REDIS_URL` for multi-replica) are set.
- [ ] `/metrics` is bound to a private port / network, not exposed publicly.
- [ ] If `SCORER=ml`, confirm `GET /v1/config/model` shows the intended `provenance` — `synthetic-demo` means the bundled demo model is serving, not a real one.

## Rollout & rollback
- [ ] Deploy the engine, then the dashboard.
- [ ] Multi-replica: after a **policy or list change**, do a rolling restart so every replica reloads it (see KNOWN-LIMITATIONS).
- [ ] Rollback plan: policies roll back via the dashboard (version history); a bad image rolls back by redeploying the previous tag. Migrations are additive, so the previous image runs against the newer schema.

## Compatibility
- [ ] Confirm no breaking change to the `/v1` request/response contract; if one is unavoidable in beta, call it out prominently in `CHANGELOG.md`.
- [ ] Note the compatible `verdict-dashboard` commit/tag for this engine version.
