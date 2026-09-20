import { type CallHandler, type ExecutionContext, Inject, Injectable, type NestInterceptor } from "@nestjs/common";
import { type Observable, tap } from "rxjs";
import { causeMessage, logEvent } from "../observability/log";
import { type Principal } from "../ports/token-verifier.port";
import { redactBody } from "../domain/audit";
import { AUDIT_LOG, type AuditLog } from "./audit-log";

interface AuditableRequest {
  method: string;
  originalUrl?: string;
  url?: string;
  body?: unknown;
  principal?: Principal;
}

const MUTATING = new Set(["POST", "PUT", "PATCH", "DELETE"]);

/**
 * Records every operator/admin mutation in the audit log. It fires only for a request carrying an
 * operator principal (bearer token) — API-key traffic on the decision path sets `req.apiKey`, not
 * `req.principal`, so the hot path is never audited. Auth flows are skipped (token noise/secrets) and
 * so is the audit read itself. Recording is best-effort: a store hiccup never fails the operator's request.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  constructor(@Inject(AUDIT_LOG) private readonly audit: AuditLog) {}

  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<AuditableRequest>();
    const path = (req.originalUrl ?? req.url ?? "").split("?")[0];
    if (!MUTATING.has(req.method) || !req.principal?.email || this.skip(path)) return next.handle();

    return next.handle().pipe(
      tap(() => {
        const res = ctx.switchToHttp().getResponse<{ statusCode?: number }>();
        const status = res.statusCode ?? (req.method === "POST" ? 201 : 200);
        const params = req.body && Object.keys(req.body as object).length > 0 ? redactBody(req.body) : undefined;
        void this.audit
          .record({ actor: req.principal!.email, role: req.principal!.role, action: `${req.method} ${path}`, status, params })
          .catch((cause) => logEvent("error", "audit.record_failed", { action: `${req.method} ${path}`, cause: causeMessage(cause) }));
      }),
    );
  }

  private skip(path: string): boolean {
    return path.startsWith("/v1/auth/") || path === "/v1/audit";
  }
}
