import type { Role } from "../domain/user";

export interface AuthResult {
  token: string;
  user: { email: string; role: Role };
}

export interface UserSummary {
  email: string;
  role: Role;
  createdAt: string;
}

export interface AuthPort {
  /** Bootstrap: creates the first user as admin. Fails once any user exists. */
  register(email: string, password: string): Promise<AuthResult>;
  login(email: string, password: string): Promise<AuthResult>;
  /** Admin action: create an additional operator. */
  createUser(email: string, password: string, role: Role): Promise<UserSummary>;
  status(): Promise<{ needsBootstrap: boolean }>;
  listUsers(): Promise<UserSummary[]>;
  /** Revoke a single token (this session's logout). */
  logout(token: string): Promise<void>;
  /** Revoke every session for the token's user (sign out everywhere). */
  logoutAll(token: string): Promise<void>;
  /** Exchange a still-valid token for a fresh one (sliding session). */
  refresh(token: string): Promise<AuthResult>;
}

export const AUTH_PORT = Symbol("AuthPort");
