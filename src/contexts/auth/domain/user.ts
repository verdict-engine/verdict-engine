export type Role = "admin" | "analyst";

export interface User {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: Role;
  readonly createdAt: string;
}
