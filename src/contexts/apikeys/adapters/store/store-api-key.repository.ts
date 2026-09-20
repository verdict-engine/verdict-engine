import { Inject, Injectable } from "@nestjs/common";
import { STORE, type Collection, type Store } from "@shared/ports/store.port";
import type { ApiKeyRepositoryPort } from "../../application/api-key-repository.port";
import type { ApiKey } from "../../domain/api-key";

@Injectable()
export class StoreApiKeyRepository implements ApiKeyRepositoryPort {
  private readonly keys: Collection<ApiKey>;

  constructor(@Inject(STORE) store: Store) {
    this.keys = store.collection<ApiKey>("apikeys");
  }

  async save(key: ApiKey): Promise<void> {
    await this.keys.put(key.id, key);
  }

  get(id: string): Promise<ApiKey | null> {
    return this.keys.get(id);
  }

  async findByHash(hash: string): Promise<ApiKey | null> {
    return (await this.keys.all()).find((k) => k.hash === hash) ?? null;
  }

  all(): Promise<ApiKey[]> {
    return this.keys.all();
  }
}
