import {
  type CanActivate,
  type ExecutionContext,
  Inject,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { TOKEN_VERIFIER, type Principal, type TokenVerifier } from "../ports/token-verifier.port";

interface AuthedRequest {
  headers: Record<string, string | undefined>;
  principal?: Principal;
}

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(@Inject(TOKEN_VERIFIER) private readonly verifier: TokenVerifier) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const req = ctx.switchToHttp().getRequest<AuthedRequest>();
    const header = req.headers.authorization ?? "";
    const token = header.startsWith("Bearer ") ? header.slice(7) : "";
    const principal = token ? await this.verifier.verify(token) : null;
    if (!principal) throw new UnauthorizedException({ error: true, code: "UNAUTHENTICATED" });
    req.principal = principal;
    return true;
  }
}
