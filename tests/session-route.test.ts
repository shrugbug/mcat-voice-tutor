import { afterEach, describe, expect, test, vi } from 'vitest';
import { GET } from '../app/api/session/route';

describe('GET /api/session cost ceiling', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test('rate-limits repeated client-secret minting', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({
        ok: true,
        json: async () => ({ value: 'ephemeral-secret', expires_at: 1_800_000_000 }),
      }))
    );

    const responses = await Promise.all(Array.from({ length: 6 }, () => GET()));

    expect(responses.slice(0, 5).every((response) => response.status === 200)).toBe(true);
    expect(responses[5].status).toBe(429);
    expect(responses[5].headers.get('retry-after')).toBeTruthy();
  });
});
