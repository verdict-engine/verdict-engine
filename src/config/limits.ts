const perMin = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
};

/**
 * Per-caller request budgets, overridable per deployment via env. Defaults are generous
 * enough for normal traffic and low enough to blunt brute-force and abuse.
 */
export const LIMITS = {
  windowMs: 60_000,
  decisionsPerMin: perMin(process.env.RATE_LIMIT_DECISIONS_PER_MIN, 600),
  loginPerMin: perMin(process.env.RATE_LIMIT_LOGIN_PER_MIN, 10),
};
