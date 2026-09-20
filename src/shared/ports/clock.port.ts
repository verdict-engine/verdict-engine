/**
 * Clock — time is an injected dependency, never `new Date()` in domain code.
 * Makes every scoring window and velocity counter deterministic under test.
 */
export interface Clock {
  now(): Date;
  isoNow(): string;
}

export const CLOCK = Symbol("Clock");
