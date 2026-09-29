import { Inject, Injectable } from "@nestjs/common";
import { CLOCK, type Clock } from "@shared/ports/clock.port";
import { ID_GENERATOR, type IdGenerator } from "@shared/ports/id-generator.port";
import { DomainError } from "@shared/domain/result";
import { DEFAULT_ORG, currentOrg } from "@shared/adapters/tenant-context";
import type { ApiKeyPrincipal, ApiKeyVerifier } from "@shared/ports/api-key-verifier.port";
import { API_KEY_SCOPES, effectiveScopes, generateKey, hashKey, isExpired, summarize, type ApiKey, type ApiKeySummary } from "../domain/api-key";
import type { ApiKeysPort, CreateKeyOptions, CreatedKey } from "./api-keys.port";
import {
  API_KEY_REPOSITORY_PORT,
  type ApiKeyRepositoryPort,
} from "./api-key-repository.port";

@Injectable()
export class ApiKeysService implements ApiKeysPort, ApiKeyVerifier {
  constructor(
    @Inject(API_KEY_REPOSITORY_PORT) private readonly keys: ApiKeyRepositoryPort,
    @Inject(ID_GENERATOR) private readonly ids: IdGenerator,
    @Inject(CLOCK) private readonly clock: Clock,
  ) {}

  async create(name: string, createdBy: string, options: CreateKeyOptions = {}): Promise<CreatedKey> {
    const label = name.trim();
    if (!label) throw new DomainError("API_KEY_NAME_REQUIRED", "a name is required");
    const scopes = this.validateScopes(options.scopes);
    const expiresAt = this.expiryFrom(options.expiresInDays);
    const { plaintext, hash, prefix } = generateKey();
    const key: ApiKey = {
      id: this.ids.next("key"),
      name: label,
      hash,
      prefix,
      createdBy,
      orgId: currentOrg() ?? DEFAULT_ORG,
      createdAt: this.clock.isoNow(),
      scopes,
      expiresAt,
    };
    await this.keys.save(key);
    return { key: summarize(key, this.clock.isoNow()), plaintext };
  }

  async list(): Promise<ApiKeySummary[]> {
    const now = this.clock.isoNow();
    return (await this.keys.all()).map((k) => summarize(k, now)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }

  async revoke(id: string): Promise<void> {
    const key = await this.keys.get(id);
    if (!key) throw new DomainError("API_KEY_NOT_FOUND", `key ${id} not found`);
    if (!key.revokedAt) await this.keys.save({ ...key, revokedAt: this.clock.isoNow() });
  }

  async verify(key: string): Promise<ApiKeyPrincipal | null> {
    const found = await this.keys.findByHash(hashKey(key));
    if (!found || found.revokedAt || isExpired(found, this.clock.isoNow())) return null;
    return { id: found.id, name: found.name, scopes: effectiveScopes(found), orgId: found.orgId ?? DEFAULT_ORG };
  }

  private validateScopes(scopes?: string[]): string[] | undefined {
    if (!scopes || scopes.length === 0) return undefined; // undefined = all scopes
    const allowed = new Set<string>(API_KEY_SCOPES);
    const invalid = scopes.filter((s) => !allowed.has(s));
    if (invalid.length > 0) {
      throw new DomainError("API_KEY_INVALID_SCOPE", `unknown scope(s): ${invalid.join(", ")}. Allowed: ${[...allowed].join(", ")}`);
    }
    return [...new Set(scopes)];
  }

  private expiryFrom(days?: number): string | undefined {
    if (days === undefined) return undefined;
    if (!Number.isFinite(days) || days <= 0) {
      throw new DomainError("API_KEY_INVALID_EXPIRY", "expiresInDays must be a positive number");
    }
    return new Date(new Date(this.clock.isoNow()).getTime() + days * 86_400_000).toISOString();
  }
}
