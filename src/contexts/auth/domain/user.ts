export type Role = "admin" | "analyst";

export interface User {
  readonly id: string;
  readonly email: string;
  readonly passwordHash: string;
  readonly role: Role;
  /** The tenant this user belongs to. Absent on legacy rows → the default org. */
  readonly orgId?: string;
  readonly createdAt: string;
}
