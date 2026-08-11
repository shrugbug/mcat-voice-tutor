import { describe, expect, test, vi } from 'vitest';
import nextConfig from '../next.config';

describe('next.config', () => {
  test('does not inline SENTRY_DSN at build time', () => {
    const env = nextConfig.env ?? {};
    expect('SENTRY_DSN' in env).toBe(false);
  });
});

describe('instrumentation-client', () => {
  test('uses NEXT_PUBLIC_SENTRY_DSN at runtime', async () => {
    vi.resetModules();
    process.env.SENTRY_DSN = 'server-dsn';
    process.env.NEXT_PUBLIC_SENTRY_DSN = 'client-dsn';

    const init = vi.fn();
    const setTag = vi.fn();
    vi.doMock('@sentry/nextjs', () => ({ init, setTag }));

    await import('../instrumentation-client');

    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'client-dsn',
        enabled: true,
      })
    );
  });
});

describe('instrumentation (server)', () => {
  test('uses SENTRY_DSN and MCAT_INSTANCE', async () => {
    vi.resetModules();
    process.env.SENTRY_DSN = 'server-dsn';
    process.env.MCAT_INSTANCE = 'demo';

    const init = vi.fn();
    const setTag = vi.fn();
    const captureRequestError = vi.fn();
    vi.doMock('@sentry/nextjs', () => ({ init, setTag, captureRequestError }));

    const mod = await import('../instrumentation');
    mod.register();

    expect(init).toHaveBeenCalledTimes(1);
    expect(init).toHaveBeenCalledWith(
      expect.objectContaining({
        dsn: 'server-dsn',
        enabled: true,
      })
    );
    expect(setTag).toHaveBeenCalledWith('instance', 'demo');
  });
});
