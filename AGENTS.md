# AGENTS.md — Verdict Engine

Context for AI coding agents (Claude Code, Cursor, etc.) working in this repo.
Read this first, then the file you need under [`.agents/`](./.agents/). Human
contributors: start with [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## What this is

Verdict is an open-source fraud & risk **decisioning** engine: one event in, one
verdict out (`allow` / `review` / `deny`) in under 100ms. It is a **modular
monolith** (NestJS + TypeScript) built so any bounded context can later be
extracted into its own service without a rewrite.

## The five rules you must not break

1. **Two ways to cross a context boundary, only two:** a **port** (a typed
   `*.port.ts` interface, synchronous, request path) or an **event** (a
   `DomainEvent` on the bus, asynchronous, reactive). Never import another
   context's `domain/` or `adapters/` — only its `application/` surface.
2. **Ports, not classes.** Every cross-boundary dependency is an injected
   interface (`@Inject(SOME_PORT)`), bound to an adapter only in a module. Adapters
   stay private to their context.
3. **Rules propose, scoring weighs, decision decides.** Keep those three concerns
   in their own contexts. Never let a rule return a verdict or a scorer apply a policy.
4. **Fail on purpose.** Degradation resolves to the policy's `fail_open`/`fail_closed`
   outcome — never a silent block or silent allow.
5. **Additive only.** Event names and ports grow; a rename is a new version. No
   breaking changes to a published contract.

## Where to look

| You want to… | Read |
|---|---|
| Understand the system | [`ARCHITECTURE.md`](./ARCHITECTURE.md) · [`.agents/architecture.md`](./.agents/architecture.md) |
| Match the code style | [`.agents/conventions.md`](./.agents/conventions.md) |
| Not violate a boundary | [`.agents/boundaries.md`](./.agents/boundaries.md) |
| Add a bounded context | [`.agents/playbooks/add-a-context.md`](./.agents/playbooks/add-a-context.md) |
| Add a rule / signal | [`.agents/playbooks/add-a-rule-or-signal.md`](./.agents/playbooks/add-a-rule-or-signal.md) |
| Swap an adapter | [`.agents/playbooks/add-an-adapter.md`](./.agents/playbooks/add-an-adapter.md) |
| Learn the domain words | [`.agents/glossary.md`](./.agents/glossary.md) |
| Run/verify | [`.agents/commands.md`](./.agents/commands.md) |
| Know what's coming | [`.agents/roadmap.md`](./.agents/roadmap.md) |

## Before you finish a change

- `npm run type-check` passes (strict; no `any`).
- `npm run lint` passes — the boundary rules are enforced there, not just by convention.
- You did not edit generated files, and you did not add a breaking change to a
  published port or event.
