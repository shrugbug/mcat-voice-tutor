import { describe, expect, test, vi, beforeEach, afterEach } from 'vitest';
import { openDb } from '../lib/db';
import { handleToolRequest } from '../app/api/tool/route';

const SENTINEL = 'PRIVATE_STUDENT_STEM_9f2a';

describe('handleToolRequest error sanitization', () => {
  let db: ReturnType<typeof openDb>;
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    db = openDb(':memory:');
    consoleErrorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
    db.close();
  });

  test('zod validation failure does not leak the categoryId value', async () => {
    const req = new Request('http://localhost/api/tool', {
      method: 'POST',
      body: JSON.stringify({
        name: 'record_result',
        args: { categoryId: SENTINEL, correct: 'not-a-boolean', difficulty: 1, mode: 'test' },
      }),
    });

    const res = await handleToolRequest(db, req);
    const body = (await res.json()) as { error: string };

    expect(body.error).toBe('Invalid arguments for record_result');
    expect(JSON.stringify(body)).not.toContain(SENTINEL);

    const log = consoleErrorSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join(' ');
    expect(log).not.toContain(SENTINEL);
    expect(log).toContain('ZodValidation');

    const row = db
      .prepare('SELECT tool, message, arg_keys FROM tool_errors')
      .get() as { tool: string; message: string; arg_keys: string } | undefined;

    expect(row).toBeTruthy();
    expect(row!.tool).toBe('record_result');
    expect(row!.arg_keys).toBe('categoryId,correct,difficulty,mode');
    expect(row!.message).toContain('ZodValidation');
    expect(JSON.stringify(row)).not.toContain(SENTINEL);
  });

  test('unknown categoryId error does not leak the value', async () => {
    const req = new Request('http://localhost/api/tool', {
      method: 'POST',
      body: JSON.stringify({
        name: 'generate_question',
        args: { categoryId: SENTINEL, difficulty: 1, style: 'discrete' },
      }),
    });

    const res = await handleToolRequest(db, req);
    const body = (await res.json()) as { error: string };

    expect(body.error).toBe('Invalid arguments for generate_question');
    expect(JSON.stringify(body)).not.toContain(SENTINEL);

    const log = consoleErrorSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join(' ');
    expect(log).not.toContain(SENTINEL);
    expect(log).toContain('UnknownCategory');

    const row = db
      .prepare('SELECT tool, message, arg_keys FROM tool_errors')
      .get() as { tool: string; message: string; arg_keys: string } | undefined;

    expect(row).toBeTruthy();
    expect(row!.tool).toBe('generate_question');
    expect(row!.message).not.toContain(SENTINEL);
    expect(row!.message).toContain('UnknownCategory');
  });

  test('malformed JSON does not leak the raw body', async () => {
    const req = new Request('http://localhost/api/tool', {
      method: 'POST',
      body: `categoryId: ${SENTINEL}`,
    });

    const res = await handleToolRequest(db, req);
    const body = (await res.json()) as { error: string };

    expect(body.error).toBe('Invalid request');
    expect(JSON.stringify(body)).not.toContain(SENTINEL);

    const log = consoleErrorSpy.mock.calls.map((c: unknown[]) => c.join(' ')).join(' ');
    expect(log).not.toContain(SENTINEL);
    expect(log).toContain('MalformedRequest');
  });

  test('rejects a request before parsing or dispatch when the paid-operation limit is exhausted', async () => {
    const req = new Request('http://localhost/api/tool', {
      method: 'POST',
      body: 'not json',
    });

    const res = await handleToolRequest(db, req, () => ({ allowed: false, retryAfterSeconds: 37 }));

    expect(res.status).toBe(429);
    expect(res.headers.get('retry-after')).toBe('37');
    await expect(res.json()).resolves.toEqual({ error: 'Too many tool requests' });
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  test('rejects an oversized tool name without logging the supplied value', async () => {
    const suppliedName = `tool-${'x'.repeat(65)}`;
    const req = new Request('http://localhost/api/tool', {
      method: 'POST',
      body: JSON.stringify({ name: suppliedName, args: {} }),
    });

    const res = await handleToolRequest(db, req);
    const body = (await res.json()) as { error: string };

    expect(body.error).toBe('Invalid request');
    expect(JSON.stringify(body)).not.toContain(suppliedName);
    expect(consoleErrorSpy.mock.calls.flat().join(' ')).not.toContain(suppliedName);
  });
});
