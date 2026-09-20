import type { ApiKeySummary } from "../domain/api-key";

export interface CreatedKey {
  key: ApiKeySummary;
  /** The plaintext key — returned once, never stored or shown again. */
  plaintext: string;
}

export interface CreateKeyOptions {
  /** Scopes to grant; defaults to all if omitted. */
  scopes?: string[];
  /** Days until the key expires; omitted = never. */
  expiresInDays?: number;
}

export interface ApiKeysPort {
  create(name: string, createdBy: string, options?: CreateKeyOptions): Promise<CreatedKey>;
  list(): Promise<ApiKeySummary[]>;
  revoke(id: string): Promise<void>;
}

export const API_KEYS_PORT = Symbol("ApiKeysPort");
