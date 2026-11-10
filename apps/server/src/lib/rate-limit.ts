export interface RateLimiter {
  /** Counts one hit for `key`; `ok` is false once the window's limit is exceeded. */
  hit(key: string): { ok: boolean; retryAfterSec: number };
  reset(key: string): void;
}

/** Fixed-window in-memory limiter. State is per process and lost on restart. */
export function createRateLimiter(opts: { max: number; windowMs: number; now?: () => number }): RateLimiter {
  const now = opts.now ?? Date.now;
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return {
    hit(key) {
      const t = now();
      if (buckets.size > 10_000) for (const [k, b] of buckets) if (b.resetAt <= t) buckets.delete(k);
      let b = buckets.get(key);
      if (!b || b.resetAt <= t) {
        b = { count: 0, resetAt: t + opts.windowMs };
        buckets.set(key, b);
      }
      b.count++;
      return { ok: b.count <= opts.max, retryAfterSec: Math.ceil((b.resetAt - t) / 1000) };
    },
    reset(key) {
      buckets.delete(key);
    },
  };
}
