export type RateLimitResult = { allowed: boolean; retryAfterSeconds: number };
export type RateLimitCheck = (client: string) => RateLimitResult;

export function rateLimitSetting(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

// Process-local; idle entries are removed on the next request after expiry.
export function createFixedWindowRateLimit(limit: number, windowMs: number): RateLimitCheck {
  const windows = new Map<string, { expires: number; count: number }>();
  return (client) => {
    const now = Date.now();
    for (const [key, entry] of windows) if (entry.expires <= now) windows.delete(key);
    let entry = windows.get(client);
    if (!entry) {
      entry = { expires: now + windowMs, count: 0 };
      windows.set(client, entry);
    }
    if (entry.count >= limit) {
      return { allowed: false, retryAfterSeconds: Math.max(1, Math.ceil((entry.expires - now) / 1000)) };
    }
    entry.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  };
}
