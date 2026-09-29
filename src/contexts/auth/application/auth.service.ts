import { Inject, Injectable } from "@nestjs/common";
import { CLOCK, type Clock } from "@shared/ports/clock.port";
import { ID_GENERATOR, type IdGenerator } from "@shared/ports/id-generator.port";
import { STORE, type Collection, type Store } from "@shared/ports/store.port";
import { DomainError } from "@shared/domain/result";
import { DEFAULT_ORG, currentOrg } from "@shared/adapters/tenant-context";
import type { Principal, TokenVerifier } from "@shared/ports/token-verifier.port";
import { hashPassword, verifyPassword } from "../domain/credentials";
import { signToken, verifyToken, type TokenClaims, type TokenConfig } from "../domain/token";
import type { Role, User } from "../domain/user";
import type { AuthPort, AuthResult, UserSummary } from "./auth.port";
import { TOKEN_CONFIG } from "./token-config";
import { USER_REPOSITORY_PORT, type UserRepositoryPort } from "./user-repository.port";

const MIN_PASSWORD = 8;

/** A revoked token id, kept until the token would have expired anyway. */
interface RevokedToken {
  jti: string;
  exp: number;
}

/** Per-user cutoff: tokens issued before this are rejected (sign-out-everywhere). */
interface UserSession {
  email: string;
  validFrom: number;
}

@Injectable()
export class AuthService implements AuthPort, TokenVerifier {
  private readonly revoked: Collection<RevokedToken>;
  private readonly sessions: Collection<UserSession>;

  constructor(
    @Inject(USER_REPOSITORY_PORT) private readonly users: UserRepositoryPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(STORE) store: Store,
    @Inject(TOKEN_CONFIG) private readonly tokens: TokenConfig,
  ) {
    this.revoked = store.collection<RevokedToken>("revoked-tokens");
    this.sessions = store.collection<UserSession>("user-sessions");
  }

  async register(email: string, password: string): Promise<AuthResult> {
    // Open registration is only for the very first (admin) account.
    if (await this.users.hasAny()) {
      throw new DomainError("REGISTRATION_CLOSED", "an admin already exists — ask them to add you");
    }
    return this.tokenFor(await this.create(email, password, "admin", DEFAULT_ORG));
  }

  async createUser(email: string, password: string, role: Role, orgId?: string): Promise<UserSummary> {
    // A new operator joins the caller's tenant, unless an org is named explicitly (provisioning a new org).
    return summarize(await this.create(email, password, role, orgId ?? currentOrg() ?? DEFAULT_ORG));
  }

  async login(email: string, password: string): Promise<AuthResult> {
    const user = await this.users.findByEmail(email.trim().toLowerCase());
    if (!user || !verifyPassword(password, user.passwordHash)) {
      throw new DomainError("INVALID_CREDENTIALS", "invalid email or password");
    }
    return this.tokenFor(user);
  }

  async status(): Promise<{ needsBootstrap: boolean }> {
    return { needsBootstrap: !(await this.users.hasAny()) };
  }

  async listUsers(): Promise<UserSummary[]> {
    // Users are stored globally (email is a system-wide identity); show only the caller's tenant.
    const org = currentOrg() ?? DEFAULT_ORG;
    return (await this.users.all())
      .filter((u) => (u.orgId ?? DEFAULT_ORG) === org)
      .map(summarize)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  }

  async verify(token: string): Promise<Principal | null> {
    const claims = verifyToken(this.tokens, token, Date.now());
    if (!claims || (await this.isRevoked(claims))) return null;
    return { userId: claims.sub, email: claims.email, role: claims.role, orgId: claims.org ?? DEFAULT_ORG };
  }

  async logout(token: string): Promise<void> {
    const claims = verifyToken(this.tokens, token, Date.now());
    if (claims) await this.revoked.put(claims.jti, { jti: claims.jti, exp: claims.exp });
  }

  async logoutAll(token: string): Promise<void> {
    const claims = verifyToken(this.tokens, token, Date.now());
    if (claims) await this.sessions.put(claims.email, { email: claims.email, validFrom: Date.now() });
  }

  async refresh(token: string): Promise<AuthResult> {
    const principal = await this.verify(token);
    if (!principal) throw new DomainError("INVALID_TOKEN", "token is invalid, expired, or revoked");
    const user = await this.users.findByEmail(principal.email);
    if (!user) throw new DomainError("INVALID_TOKEN", "user no longer exists");
    return this.tokenFor(user);
  }

  private async isRevoked(claims: TokenClaims): Promise<boolean> {
    if (await this.revoked.get(claims.jti)) return true;
    const session = await this.sessions.get(claims.email);
    return session !== null && claims.iat < session.validFrom;
  }

  private async create(email: string, password: string, role: Role, orgId: string): Promise<User> {
    const normalized = email.trim().toLowerCase();
    if (password.length < MIN_PASSWORD) {
      throw new DomainError("WEAK_PASSWORD", `password must be at least ${MIN_PASSWORD} characters`);
    }
    if (await this.users.findByEmail(normalized)) {
      throw new DomainError("EMAIL_TAKEN", "email is already registered");
    }
    const user: User = {
      id: this.ids.next("usr"),
      email: normalized,
      passwordHash: hashPassword(password),
      role,
      orgId,
      createdAt: this.clock.isoNow(),
    };
    await this.users.save(user);
    return user;
  }

  private tokenFor(user: User): AuthResult {
    const principal: Principal = {
      userId: user.id,
      email: user.email,
      role: user.role,
      orgId: user.orgId ?? DEFAULT_ORG,
    };
    const token = signToken(this.tokens, principal, this.ids.next("tok"), Date.now());
    return { token, user: { email: user.email, role: user.role } };
  }
}

function summarize(user: User): UserSummary {
  return { email: user.email, role: user.role, createdAt: user.createdAt };
}
