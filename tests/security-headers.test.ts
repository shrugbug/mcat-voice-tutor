import { expect, test } from 'vitest';
import config from '../next.config';

test('all paths get report-only CSP plus enforced anti-framing, sniffing and referrer protection', async () => {
  const rules = await config.headers?.();
  const headers = new Headers(rules?.find(rule => rule.source === '/:path*')?.headers.map(h => [h.key, h.value]));
  expect(headers.get('X-Content-Type-Options')).toBe('nosniff');
  expect(headers.get('Referrer-Policy')).toBe('strict-origin-when-cross-origin');
  expect(headers.get('Content-Security-Policy')).toBe("frame-ancestors 'none'");
  const report = headers.get('Content-Security-Policy-Report-Only');
  expect(report).toContain("default-src 'self'");
  expect(report).toContain("object-src 'none'");
  expect(report).toContain("frame-ancestors 'none'");
  expect(report).toContain('https://api.openai.com');
});
