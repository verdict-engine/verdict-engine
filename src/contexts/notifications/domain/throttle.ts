/**
 * A fixed-window rate limiter keyed by channel id, used to cap alerts per channel per minute.
 * In-memory and per-replica: throttling is advisory (dropping some alerts under a storm is the
 * point), so an approximate cap that resets each window is enough and needs no shared state.
 */
export class WindowThrottle {
  private readonly windows = new Map<string, { start: number; count: number }>();

  constructor(private readonly windowMs = 60_000) {}

  /** Records an allowed hit and returns true; returns false if `key` is over `limit` this window. `limit <= 0` = unlimited. */
  allow(key: string, limit: number, now: number): boolean {
    if (limit <= 0) return true;
    const w = this.windows.get(key);
    if (!w || now - w.start >= this.windowMs) {
      this.windows.set(key, { start: now, count: 1 });
      return true;
    }
    if (w.count >= limit) return false;
    w.count += 1;
    return true;
  }
}
