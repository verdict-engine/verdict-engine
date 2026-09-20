# Playbook — add a bounded context

Use when adding a new area that owns its own data and rules (e.g. `analytics`,
`agents`). Mirrors the existing contexts under `src/contexts/`.

## Steps

1. **Create the folder skeleton** `src/contexts/<name>/`:
   ```
   domain/            pure types (no framework, no I/O)
   application/        <name>.port.ts (interface + Symbol token) + service(s) + *.contracts.ts
   adapters/           http/ · persistence/ · <external>/  (all private)
   <name>.module.ts    binds ports→adapters, exports only the port token(s)
   ```
2. **Define the inbound port** in `application/<name>.port.ts`:
   ```ts
   export interface FooPort { do(input: In): Promise<Result<Out>>; }
   export const FOO_PORT = Symbol("FooPort");
   ```
3. **Re-export any type other contexts will need** from that port file (never let
   them import your `domain/`).
4. **Implement the service** in `application/*.service.ts`, injecting outbound
   ports via `@Inject(TOKEN)`. Business logic here; orchestration stays thin.
5. **Write adapters** in `adapters/` for each outbound port. Keep them private.
6. **Wire the module** — `{ provide: FOO_PORT, useClass: FooService }`, bind adapters,
   `exports: [FOO_PORT]`.
7. **Register** the module in `src/app.module.ts` (the composition root).
8. **Decide how it's reached:**
   - needs an answer synchronously on the request path → expose a **port**;
   - reacts to something that happened → **subscribe** to an event in the service's
     `onModuleInit` (see `cases/application/case.service.ts`).
9. **Tests** — a unit spec mocking the ports (`vitest-mock-extended`) and, if it has
   an HTTP adapter, an e2e spec. See [`add-a-rule-or-signal.md`](./add-a-rule-or-signal.md)
   and the testing notes in [`../roadmap.md`](../roadmap.md).
10. **Verify** — `npm run type-check` and `npm run lint` (boundary rules).

## Checklist

- [ ] No import of another context's `domain/` or `adapters/` (only `application/`).
- [ ] Adapters private; only port tokens exported.
- [ ] Time via the `Clock` port, not `new Date()`.
- [ ] Cross-boundary types re-exported from `application/`.
- [ ] Unit + (if applicable) e2e tests added.
