import type { ApiKey } from "../domain/api-key";

export interface ApiKeyRepositoryPort {
  save(key: ApiKey): Promise<void>;
  get(id: string): Promise<ApiKey | null>;
  findByHash(hash: string): Promise<ApiKey | null>;
  all(): Promise<ApiKey[]>;
}

export const API_KEY_REPOSITORY_PORT = Symbol("ApiKeyRepositoryPort");
