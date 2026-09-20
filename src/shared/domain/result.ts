/**
 * Result<T, E> — explicit success-or-failure so use-cases don't throw for expected
 * outcomes (a denied verdict, a rejected payload); exceptions stay for the exceptional.
 */
export type Result<T, E = DomainError> =
  | { readonly ok: true; readonly value: T }
  | { readonly ok: false; readonly error: E };

export const ok = <T>(value: T): Result<T, never> => ({ ok: true, value });
export const err = <E>(error: E): Result<never, E> => ({ ok: false, error });

export class DomainError extends Error {
  constructor(
    readonly code: string,
    message: string,
    readonly cause?: unknown,
  ) {
    super(message);
    this.name = "DomainError";
  }
}
