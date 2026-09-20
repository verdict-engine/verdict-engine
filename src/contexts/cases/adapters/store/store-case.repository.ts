import { Inject, Injectable } from "@nestjs/common";
import { STORE, type Collection, type Store } from "@shared/ports/store.port";
import type { CaseId } from "@shared/domain/ids";
import type { CaseRepositoryPort } from "../../application/case-repository.port";
import type { FraudCase } from "../../domain/fraud-case";

@Injectable()
export class StoreCaseRepository implements CaseRepositoryPort {
  private readonly cases: Collection<FraudCase>;

  constructor(@Inject(STORE) store: Store) {
    this.cases = store.collection<FraudCase>("cases");
  }

  async save(fraudCase: FraudCase): Promise<void> {
    await this.cases.put(fraudCase.id, fraudCase);
  }

  async get(id: CaseId): Promise<FraudCase | null> {
    return this.cases.get(id);
  }

  async listByQueue(queue: string): Promise<FraudCase[]> {
    return (await this.cases.all())
      .filter((c) => c.queue === queue)
      .sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  }
}
