import Database from 'better-sqlite3';
import { describe, expect, test } from 'vitest';
import { openDb } from '../lib/db';
import { argKeys, recordToolError } from '../lib/tool-errors';

describe('argKeys', () => {
  test('returns only key names, never values', () => {
    // Args carry question stems and studentReasoning; pm2 logs are plaintext on the VPS.
    const keys = argKeys({ categoryId: '4A', stem: 'A frog jumps...', studentReasoning: 'I guessed' });
    expect(keys).toBe('categoryId,stem,studentReasoning');
    expect(keys).not.toContain('frog');
    expect(keys).not.toContain('guessed');
  });

  test('handles non-object args without throwing', () => {
    expect(argKeys(null)).toBe('');
    expect(argKeys('a string')).toBe('');
    expect(argKeys([1, 2])).toBe('');
  });
});

describe('recordToolError', () => {
  test('writes exactly one row carrying no arg values', () => {
    const db = openDb(':memory:');
    recordToolError(db, 'render_view', 'Too many rows', { rows: ['secret'] });

    const rows = db.prepare('SELECT tool, message, arg_keys FROM tool_errors').all();
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ tool: 'render_view', message: 'Too many rows', arg_keys: 'rows' });
    expect(JSON.stringify(rows[0])).not.toContain('secret');
    db.close();
  });

  test('does not throw when the table is absent (older db)', () => {
    const bare = new Database(':memory:') as unknown as Parameters<typeof recordToolError>[0];
    expect(() => recordToolError(bare, 'x', 'y', {})).not.toThrow();
    (bare as unknown as Database.Database).close();
  });
});
