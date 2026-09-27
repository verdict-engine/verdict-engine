# Contributing to Verdict

Thanks for your interest in improving Verdict. Contributions of every kind are welcome — bug reports, documentation, tests, and features.

> Verdict is in **beta** (pre-1.0). Internals and APIs can still change; if you're planning a large change, open an issue first so we can agree on the approach before you invest the time.

## Ways to contribute

- **Report a bug** — open an issue with steps to reproduce, what you expected, and what happened (engine version, `SCORER`, and store type help).
- **Suggest a feature** — open an issue describing the problem before the solution.
- **Improve docs** — the docs site (`../verdict-ui`) and the Markdown in this repo.
- **Send a pull request** — see the workflow below.

Please do **not** open a public issue for a security vulnerability — see [SECURITY.md](./SECURITY.md).

## Development setup

Requires **Node.js ≥ 20** and npm.

```bash
git clone https://github.com/your-org/verdict-engine.git
cd verdict-engine
npm install
npm run start:dev        # http://localhost:4000 (in-memory store without DATABASE_URL)
```

Read [ARCHITECTURE.md](./ARCHITECTURE.md) first — Verdict is a modular monolith with strict context boundaries, and the linter enforces them.

## Pull request workflow

1. Fork and branch from `main` (e.g. `fix/rate-limit-window`, `feat/geo-resolver`).
2. Make focused changes — one concern per PR. Match the surrounding code's style and idioms.
3. Keep changes **additive and backward-compatible** where possible; call out any breaking change explicitly in the PR description.
4. Add or update tests for what you change.
5. Run the full gate locally (see below) — it must pass.
6. Open the PR with a clear description of the *why*, not just the *what*, and link the issue it closes.

## Quality gate

Every change must pass, and CI runs the same:

```bash
npm run type-check   # strict TypeScript, no `any`
npm run lint         # style + architecture boundary checks
npm run test         # Vitest unit suite
npm run test:e2e     # end-to-end tests under test/
npm run audit:ci     # high-severity production-dependency check
```

Guidelines that keep review fast:

- **No `any`** and no `@ts-ignore` to silence real type errors — fix the type.
- **Comment the non-obvious *why*,** not the *what*; prefer fewer, higher-value comments.
- **Respect context boundaries** — cross-context calls go through typed ports or domain events, never direct imports of another context's internals.
- **Retrain deliberately** — if you touch the ML feature vector, regenerate the weights (`npm run train:model`) and keep the training/serving extractor in sync.
- **Never commit secrets**, real API keys, or a full PAN (BIN only). The verdict log is append-only.

## Commit messages

Short, imperative subject lines; a body explaining the reasoning when the change isn't obvious. Conventional-commit prefixes (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`) are appreciated but not required.

## License

By contributing, you agree that your contributions are licensed under the project's [Apache-2.0](./LICENSE) license.
