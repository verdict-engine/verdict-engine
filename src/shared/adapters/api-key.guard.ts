import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { API_KEY_VERIFIER, type ApiKeyPrincipal, type ApiKeyVerifier } from "../ports/api-key-verifier.port";
import { API_KEY_SCOPE_KEY } from "./api-key-scope.decorator";

interface KeyedRequest {
  headers: Record<string, string | undefined>;
  apiKey?: ApiKeyPrincipal;
}

/** Guards machine-to-machine endpoints. The key is sent as the `X-API-Key` header. */
@Injectable()
export class ApiKeyGuard implements CanActivate {
  constructor(
    @Inject(API_KEY_VERIFIER) private readonly verifier: ApiKeyVerifier,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<KeyedRequest>();
    const key = req.headers["x-api-key"] ?? "";
    const principal = key ? await this.verifier.verify(key) : null;
    if (!principal) throw new UnauthorizedException({ error: true, code: "INVALID_API_KEY" });

    const required = this.reflector.get<string>(API_KEY_SCOPE_KEY, ctx.getHandler());
    if (required && !principal.scopes.includes(required)) {
      throw new ForbiddenException({ error: true, code: "INSUFFICIENT_SCOPE", message: `this key lacks the "${required}" scope` });
    }
    req.apiKey = principal;
    return true;
  }
}
