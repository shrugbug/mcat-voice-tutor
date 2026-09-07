import { afterEach, expect, test, vi } from 'vitest';
import { openDb } from '../lib/db';
import { handleToolRequest } from '../app/api/tool/route';
import { POST as transcript } from '../app/api/transcript/route';

afterEach(() => vi.restoreAllMocks());

for (const route of ['tool', 'transcript'] as const) {
  for (const length of [undefined, '1', String(3 * 1024 * 1024)]) {
    test(`${route} rejects multi-MB JSON before parsing (Content-Length=${length})`, async () => {
      vi.spyOn(console, 'error').mockImplementation(() => {});
      const db = openDb(':memory:');
      let cancelled = false;
      let sent = 0;
      const stream = new ReadableStream({
        pull(controller) {
          if (sent++ < 48) controller.enqueue(new TextEncoder().encode(' '.repeat(65536)));
          else { controller.enqueue(new TextEncoder().encode('{}')); controller.close(); }
        },
        cancel() { cancelled = true; },
      }, { highWaterMark: 0 });
      const request = new Request('http://localhost/api/' + route, {
        method: 'POST', body: stream, duplex: 'half',
        headers: length ? { 'Content-Length': length } : {},
      } as RequestInit);
      const parse = vi.spyOn(request, 'json');
      try {
        const response = route === 'tool'
          ? await handleToolRequest(db, request, () => ({ allowed: true, retryAfterSeconds: 0 }))
          : await transcript(request);
        expect(response.status).toBe(413);
        expect(parse).not.toHaveBeenCalled();
        expect(cancelled).toBe(true);
        expect(sent).toBeLessThan(48);
        if (length === String(3 * 1024 * 1024)) expect(sent).toBe(0);
      } finally { db.close(); }
    });
  }
}

test('byte reader accepts small UTF-8 JSON and counts multi-byte characters', async () => {
  const { readRequestJson, MAX_JSON_BYTES, BodyTooLarge } = await import('../lib/request-json');
  const make = (body: string) => new Request('http://localhost', { method: 'POST', body });
  await expect(readRequestJson(make('{"text":"你好"}'))).resolves.toEqual({ text: '你好' });
  await expect(readRequestJson(make('"' + '界'.repeat(MAX_JSON_BYTES / 2) + '"'))).rejects.toBeInstanceOf(BodyTooLarge);
  await expect(readRequestJson(make('{}' + ' '.repeat(MAX_JSON_BYTES - 2)))).resolves.toEqual({});
});
