import type { User } from "../domain/user";

export interface UserRepositoryPort {
  findByEmail(email: string): Promise<User | null>;
  save(user: User): Promise<void>;
  hasAny(): Promise<boolean>;
  all(): Promise<User[]>;
}

export const USER_REPOSITORY_PORT = Symbol("UserRepositoryPort");
