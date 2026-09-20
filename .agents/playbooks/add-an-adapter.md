# Playbook — add or swap an adapter

An adapter is a concrete implementation of a port (Redis, SQL, git, HTTP, an LLM,
a remote service). Swapping one is the whole payoff of ports — do it without
touching any caller.

## Add a new adapter for an existing port

1. Create the class under the owning context's `adapters/<tech>/`:
   ```ts
   @Injectable()
   export class RemoteScorer implements ScorerPort {
     async score(hits, features): Promise<RiskScore> { /* HTTP call */ }
   }
   ```
2. In that context's module, rebind the token:
   ```ts
   providers: [{ provide: SCORER_PORT, useClass: RemoteScorer }], // was WeightedScorer
   ```
3. Done. No consumer changes — they inject `ScorerPort`, not the class.

## Extract a context into its own service (later)

For a **synchronous** collaborator (e.g. Scoring): stand it up as its own process
behind an HTTP/gRPC adapter implementing the same port, then rebind the token in
the caller's module to a client adapter.

For a **reactive** collaborator (e.g. Cases): replace the shared kernel's
`InProcessEventBus` adapter with a Kafka/BullMQ one (`src/shared/shared.module.ts`).
Publishers and subscribers are untouched.

## Rules

- Adapters may depend on their own context and `@shared/*` — never on another
  context's internals.
- Keep secrets/config out of the adapter's code; read from injected config.
- Give the adapter a unit test with the external dependency mocked, and (for a
  persistence adapter) an integration test against a real/ephemeral instance.
