/** Small in-memory sliding window limiter. Fine for one process on one VM. */
export class RateLimiter {
  private hits = new Map<string, number[]>();

  /** Returns true if the call is allowed, and counts it. */
  allow(key: string, limit: number, windowMs: number, now = Date.now()): boolean {
    const recent = (this.hits.get(key) ?? []).filter((t) => now - t < windowMs);
    if (recent.length >= limit) {
      this.hits.set(key, recent);
      return false;
    }
    recent.push(now);
    this.hits.set(key, recent);
    return true;
  }

  /** Drops keys that have gone quiet, so the map doesn't grow forever. */
  sweep(windowMs: number, now = Date.now()) {
    for (const [key, times] of this.hits) {
      if (times.every((t) => now - t >= windowMs)) this.hits.delete(key);
    }
  }
}
