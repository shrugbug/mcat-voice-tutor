import { afterEach, expect, test, vi } from 'vitest';
import { clientIp, sessionCookie, sessionIdentity, toolClient } from '../lib/client-identity';
import { createFixedWindowRateLimit } from '../lib/rate-limit';
import { handleToolRequest } from '../app/api/tool/route';
import { openDb } from '../lib/db';

afterEach(() => { vi.unstubAllEnvs(); vi.restoreAllMocks(); });
const req = (headers = {}) => new Request('http://localhost/api/tool', { method: 'POST', headers, body: JSON.stringify({ name: 'get_profile', args: {} }) });

test('ignores untrusted forwarding and takes only the single trusted hop peer', () => {
  vi.stubEnv('TRUST_PROXY', 'false');
  expect(clientIp(req({ 'x-forwarded-for': '192.0.2.1' }))).toBe('unknown');
  vi.stubEnv('TRUST_PROXY', 'true');
  expect(clientIp(req({ 'x-forwarded-for': 'spoofed, 192.0.2.2' }))).toBe('192.0.2.2');
  expect(clientIp(req({ 'x-forwarded-for': 'invalid' }))).toBe('unknown');
});

test('cookie tampering and expiry fall back to IP; a valid cookie survives remint', () => {
  const cookie = sessionCookie(req()).split(';')[0];
  const request = req({ cookie });
  expect(sessionIdentity(request)).toBeTruthy();
  expect(sessionCookie(request).split(';')[0]).toBe(cookie);
  expect(toolClient(req({ cookie: cookie.slice(0, -1) + 'z' }))).toBe('ip:unknown');
  vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 86400001);
  expect(sessionIdentity(request)).toBeUndefined();
});

test('tool route separates issued cookies and denies only the exhausted client', async () => {
  const db = openDb(':memory:');
  const check = createFixedWindowRateLimit(1, 60000);
  const a = sessionCookie(req()).split(';')[0];
  const b = sessionCookie(req()).split(';')[0];
  try {
    expect((await handleToolRequest(db, req({ cookie: a }), check)).status).toBe(200);
    expect((await handleToolRequest(db, req({ cookie: a }), check)).status).toBe(429);
    expect((await handleToolRequest(db, req({ cookie: b }), check)).status).toBe(200);
  } finally { db.close(); }
});
