const perMin = (raw: string | undefined, fallback: number): number => {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 0 ? Math.floor(n) : fallback;
};

/**
 * Alert-channel defaults. `throttlePerMin` caps how many alerts a single channel receives per
 * minute so an alert storm (e.g. a flood of anomaly alerts) can't hammer Slack/Telegram or bury an
 * operator; excess alerts in a window are dropped, not queued. `0` = unlimited. A channel can
 * override it at registration.
 */
export const NOTIFY = {
  throttlePerMin: perMin(process.env.NOTIFY_THROTTLE_PER_MIN, 60),
};
