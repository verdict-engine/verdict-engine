import { type CallHandler, type ExecutionContext, Injectable, type NestInterceptor } from "@nestjs/common";
import { Observable } from "rxjs";
import type { Principal } from "../ports/token-verifier.port";
import type { ApiKeyPrincipal } from "../ports/api-key-verifier.port";
import { runWithOrg } from "./tenant-context";

interface ScopedRequest {
  principal?: Principal;
  apiKey?: ApiKeyPrincipal;
}

/**
 * Establishes the request's tenant for the store. Runs after the guards (which resolve the principal
 * or API key onto the request) and wraps the handler so the ambient org set here rides the
 * AsyncLocalStorage through every awaited store call. Requests with no authenticated tenant (public
 * endpoints, the pre-auth flow) run unscoped — the store then treats reads as cross-org, which is only
 * ever reachable before a tenant is known.
 */
@Injectable()
export class TenantInterceptor implements NestInterceptor {
  intercept(ctx: ExecutionContext, next: CallHandler): Observable<unknown> {
    const req = ctx.switchToHttp().getRequest<ScopedRequest>();
    const orgId = req.principal?.orgId ?? req.apiKey?.orgId;
    if (!orgId) return next.handle();
    return new Observable((subscriber) => runWithOrg(orgId, () => next.handle().subscribe(subscriber)));
  }
}
