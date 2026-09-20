# Conventions

Match these exactly — they are what make generated code look native here.

## TypeScript

- **No `any`** (explicit or implicit). Use `unknown` + narrowing for genuinely
  unknown shapes (webhook payloads, `catch (e: unknown)`).
- Explicit return types on exported functions in `application/` (ports & use-cases).
- Prefer `import type { … }` for type-only imports.
- Model expected failures with `Result<T, E>` (`@shared/domain/result`); reserve
  `throw` for truly exceptional states.
- Never `new Date()` in domain/application code — inject the `Clock` port.

## Ports & adapters

- A port is **an interface + a `Symbol` token** in one `*.port.ts` file:
  ```ts
  export interface ScorerPort { score(...): Promise<RiskScore>; }
  export const SCORER_PORT = Symbol("ScorerPort");
  ```
- Bind the token to an adapter **only in a module**, and `exports:` only the token:
  ```ts
  providers: [{ provide: SCORER_PORT, useClass: WeightedScorer }],
  exports: [SCORER_PORT],
  ```
- Consumers inject the interface, never the class: `@Inject(SCORER_PORT) private readonly scorer: ScorerPort`.
- Adapters live in `adapters/` and stay private to their context.

## Imports (this is also boundary enforcement)

- **Same context** → relative paths (`../domain/x`, `./x.port`).
- **Another context** → the `@contexts/*` alias, and **only** its
  `application/` surface (`*.port.ts` / `*.contracts.ts`). Never its `domain/`
  or `adapters/`. See [`boundaries.md`](./boundaries.md).
- Shared kernel → `@shared/*`.

## Naming

- Files: kebab-case with a role suffix — `*.port.ts`, `*.service.ts`,
  `*.adapter.ts`, `*.module.ts`, `*.contracts.ts`.
- DI tokens: `SCREAMING_SNAKE` Symbols named after the interface.
- Events: past tense, versioned strings — `"verdict.reached.v1"`.
- Ids: branded types from `@shared/domain/ids` (`UserId`, `VerdictId`, …).

## Style

- Controllers/orchestrators are thin — orchestration only, no business logic.
- Multi-write invariants go inside a transaction (money, stock, case state).
- Slow/fan-out work (enrichment, notifications, projections) goes on a queue, off
  the request path.
- Formatting is automated — don't hand-fight it; write reasonable code and run
  `npm run lint`.
