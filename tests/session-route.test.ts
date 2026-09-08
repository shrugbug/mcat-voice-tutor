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

    const responses = await Promise.all(Array.from({ length: 11 }, () => GET(new Request('http://localhost/api/session'))));

    expect(responses.slice(0, 10).every((response) => response.status === 200)).toBe(true);
    expect(responses[10].status).toBe(429);
    expect(responses[10].headers.get('retry-after')).toBeTruthy();
  });
});

 test('isolates trusted proxy clients and issues a stable server-verified tool cookie', async () => {
    vi.stubEnv('TRUST_PROXY', 'true');
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, json: async () => ({ value: 'secret', expires_at: 1800000000 }) })));
    const request = (ip: string, cookie = '') => new Request('http://localhost/api/session', { headers: { 'x-forwarded-for': ip, cookie } });
    const first = await GET(request('192.0.2.1'));
    const cookie = first.headers.get('set-cookie')?.split(';')[0];
    expect(cookie).toMatch(/^mcat_session=/);
    for (let i = 1; i < 10; i++) expect((await GET(request('192.0.2.1', cookie))).status).toBe(200);
    expect((await GET(request('192.0.2.1', cookie))).status).toBe(429);
    expect((await GET(request('192.0.2.2'))).status).toBe(200);
 });
