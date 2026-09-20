import { Inject, Injectable } from "@nestjs/common";
import { STORE, type Collection, type Store } from "@shared/ports/store.port";
import type { UserRepositoryPort } from "../../application/user-repository.port";
import type { User } from "../../domain/user";

/** Users are keyed by normalized email, so findByEmail is a direct lookup. */
@Injectable()
export class StoreUserRepository implements UserRepositoryPort {
  private readonly users: Collection<User>;

  constructor(@Inject(STORE) store: Store) {
    this.users = store.collection<User>("users");
  }

  findByEmail(email: string): Promise<User | null> {
    return this.users.get(email.toLowerCase());
  }

  async save(user: User): Promise<void> {
    await this.users.put(user.email.toLowerCase(), user);
  }

  async hasAny(): Promise<boolean> {
    return (await this.users.all()).length > 0;
  }

  async all(): Promise<User[]> {
    return this.users.all();
  }
}
