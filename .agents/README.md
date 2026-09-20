# .agents/ — repo context for LLM coding agents

This folder is written **for AI coding assistants** (and the humans who pair with
them). It is the map an agent should load before changing anything, so that
generated code matches this repo's boundaries, naming, and idioms instead of a
generic default.

Entry point is [`../AGENTS.md`](../AGENTS.md). Files here, smallest-useful first:

- [`architecture.md`](./architecture.md) — the mental model in one page (the long
  form is the repo's [`ARCHITECTURE.md`](../ARCHITECTURE.md)).
- [`conventions.md`](./conventions.md) — how code is written here (TS, DI, imports).
- [`boundaries.md`](./boundaries.md) — the one invariant that keeps the seams real.
- [`glossary.md`](./glossary.md) — domain vocabulary (verdict, signal, band…).
- [`commands.md`](./commands.md) — how to run, type-check, lint, test.
- [`roadmap.md`](./roadmap.md) — shipped/next, and the seams reserved for future work.
- [`playbooks/`](./playbooks/) — step-by-step recipes for common changes.

## How an agent should use this

1. Read `../AGENTS.md` for the non-negotiable rules.
2. Read `architecture.md` + `conventions.md` before writing code.
3. If the task is a common one, follow the matching file in `playbooks/`.
4. Keep changes additive; verify with the commands in `commands.md`.

Keep this folder **current and small**. When an invariant changes in the code,
update the relevant file here in the same change — a stale agent doc is worse than
none, because it is trusted.
