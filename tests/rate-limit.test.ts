import { afterEach, expect, test, vi } from 'vitest';
import { createFixedWindowRateLimit } from '../lib/rate-limit';

afterEach(() => vi.restoreAllMocks());

test('two clients each receive their full allowance in one window', () => {
  const check = createFixedWindowRateLimit(2, 60_000);
  expect([check('a').allowed, check('a').allowed]).toEqual([true, true]);
  expect([check('b').allowed, check('b').allowed]).toEqual([true, true]);
});

test('exhausting one client does not refuse another and windows expire', () => {
  const clock = vi.spyOn(Date, 'now').mockReturnValue(100_000);
  const check = createFixedWindowRateLimit(1, 60_000);
  expect(check('a').allowed).toBe(true);
  expect(check('a')).toEqual({ allowed: false, retryAfterSeconds: 60 });
  expect(check('b').allowed).toBe(true);
  clock.mockReturnValue(160_000);
  expect(check('a').allowed).toBe(true);
});
