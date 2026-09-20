import {
  type CanActivate,
  type ExecutionContext,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { RATE_LIMITER, type RateLimiter } from "../ports/rate-limiter.port";
import { rateLimitedTotal } from "../observability/metrics";
import { RATE_LIMIT_SETTINGS, type RateLimitSettings } from "./rate-limit-settings";
import { RATE_LIMIT_KEY, type RateLimitOptions } from "./rate-limit.decorator";

interface LimitedRequest {
  headers: Record<string, string | string[] | undefined>;
  ip?: string;
  socket?: { remoteAddress?: string };
}

interface HttpResponse {
  setHeader(name: string, value: string): void;
}

/**
 * Enforces per-handler request budgets declared with @RateLimit. Fails closed with 429 +
 * Retry-After. Unmarked handlers pass straight through. Keyed per handler so one endpoint's
 * budget never spends another's.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    @Inject(RATE_LIMITER) private readonly limiter: RateLimiter,
    @Inject(RATE_LIMIT_SETTINGS) private readonly settings: RateLimitSettings,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const options = this.reflector.get<RateLimitOptions>(RATE_LIMIT_KEY, ctx.getHandler());
    if (!options) return true;

    const req = ctx.switchToHttp().getRequest<LimitedRequest>();
    const res = ctx.switchToHttp().getResponse<HttpResponse>();
    const bucket = `${ctx.getClass().name}.${ctx.getHandler().name}`;
    // Resolve the budget at request time so a dashboard change applies without a redeploy.
    const { limit, windowMs } = await this.settings.resolve(options.name);
    const decision = await this.limiter.take(`${bucket}:${this.identify(options.by, req)}`, limit, windowMs);

    res.setHeader("X-RateLimit-Limit", String(limit));
    res.setHeader("X-RateLimit-Remaining", String(decision.remaining));
    if (!decision.allowed) {
      rateLimitedTotal.inc({ bucket });
      res.setHeader("Retry-After", String(Math.ceil(decision.retryAfterMs / 1000)));
      throw new HttpException(
        { error: true, code: "RATE_LIMITED", message: "too many requests — slow down" },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    return true;
  }

  private identify(by: "apikey" | "ip", req: LimitedRequest): string {
    if (by === "apikey") return header(req, "x-api-key") ?? "anonymous";
    // req.ip is derived by Express per the `trust proxy` setting — the real client when behind a
    // trusted proxy, the socket address otherwise. Never parse X-Forwarded-For ourselves: that
    // would trust a client-supplied header and let anyone spoof their way around per-IP limits.
    return req.ip || req.socket?.remoteAddress || "unknown";
  }
}

function header(req: LimitedRequest, name: string): string | undefined {
  const value = req.headers[name];
  return Array.isArray(value) ? value[0] : value;
}
