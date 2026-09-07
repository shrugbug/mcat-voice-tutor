export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };
export type RateLimitCheck = () => RateLimitResult;

export function createFixedWindowRateLimit(limit: number, windowMs: number): RateLimitCheck {
  let windowStartedAt = 0;
  let count = 0;

  return () => {
    const now = Date.now();
    if (now - windowStartedAt >= windowMs) {
      windowStartedAt = now;
      count = 0;
    }
    if (count >= limit) {
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((windowStartedAt + windowMs - now) / 1000)),
      };
    }
    count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  };
}
