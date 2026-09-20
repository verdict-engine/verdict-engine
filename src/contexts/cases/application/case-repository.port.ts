import type { CaseId } from "@shared/domain/ids";
import type { FraudCase } from "../domain/fraud-case";

export interface CaseRepositoryPort {
  save(fraudCase: FraudCase): Promise<void>;
  get(id: CaseId): Promise<FraudCase | null>;
  listByQueue(queue: string): Promise<FraudCase[]>;
}

export const CASE_REPOSITORY_PORT = Symbol("CaseRepositoryPort");
