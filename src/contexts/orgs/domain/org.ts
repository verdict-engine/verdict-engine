/** A tenant. Every user, API key, and the data they produce belongs to exactly one org. */
export interface Org {
  readonly id: string;
  readonly name: string;
  readonly createdAt: string;
}
