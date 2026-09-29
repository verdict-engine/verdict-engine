# Security Policy

Verdict makes fraud and risk decisions and handles sensitive signals, so we take security seriously and appreciate responsible disclosure.

> Verdict is in **beta** (pre-1.0). It is self-hostable and functional, but it has not yet had an independent security audit — evaluate it carefully before relying on it in production.

## Supported versions

While in beta, only the **latest `0.x` release** receives security fixes. Pin a version and upgrade to the latest patch when a fix ships.

| Version | Supported |
|---|---|
| latest `0.x` | ✅ |
| older `0.x`  | ❌ |

## Reporting a vulnerability

**Please do not open a public issue, PR, or discussion for a security vulnerability.**

Report it privately through **GitHub private vulnerability reporting** — the repository's **Security → Report a vulnerability** tab. This is the primary channel and needs no email address; enable it under **Settings → Code security and analysis → Private vulnerability reporting**.

> Maintainers: if you also want an email channel, add the address here. Until one is listed, use GitHub private reporting.

Please include:

- a description of the issue and its impact,
- steps to reproduce (a minimal proof-of-concept helps),
- affected version / commit and configuration (`SCORER`, store type, whether Redis is enabled),
- any suggested remediation.

Do not include real secrets, production API keys, or personal data in your report.

### What to expect

- **Acknowledgement** within a few business days.
- An assessment and, for confirmed issues, a fix or mitigation plan with a target timeline.
- Credit in the release notes if you'd like it.
- Coordinated disclosure — we'll agree on a date to publish details once a fix is available.

## Scope

In scope: the engine, its API and auth, the operator dashboard, the docs site, and the official SDKs in this project.

Out of scope: vulnerabilities in third-party dependencies (report those upstream; we track them via `npm run audit:ci`), and issues that require a misconfiguration the documentation warns against (for example running without `AUTH_SECRET`, exposing the engine's private port, or trusting an untrusted proxy for the client IP).

## Security posture (for reviewers)

Verdict is built to fail safe:

- Service **API keys** are random, **SHA-256-hashed at rest**, shown once, scoped, and revocable; operator auth uses **scrypt**-hashed passwords and signed bearer tokens with revocation and refresh.
- **Rate limiting** guards the decision endpoint (per key) and login (per IP), using the proxy-aware client IP (`TRUST_PROXY`), never a spoofable header.
- Card data is **BIN-only — never a full PAN**; the verdict log is **append-only**; phone/IP are masked in logs; secrets are scrubbed from structured logs and the config-change audit trail.
- Personal data is **erasable per user** (`POST /v1/privacy/erase`).
- The engine **refuses to start in production** without a real `AUTH_SECRET` and `DATABASE_URL`.

See the **Security** section of the [documentation](./docs) and [DEPLOYMENT.md](./DEPLOYMENT.md) for the full checklist.
