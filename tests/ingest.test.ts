import { beforeEach, describe, expect, test, vi } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../lib/db';
import { toBlob } from '../lib/rag';
import { embed } from '../lib/embeddings';
import { writeChunks } from '../scripts/ingest';

vi.mock('../lib/embeddings', () => ({ embed: vi.fn() }));

describe('writeChunks', () => {
  let db: Database.Database;

  beforeEach(() => {
    vi.mocked(embed).mockReset();
    db = openDb(':memory:');
    db.prepare('INSERT INTO chunks (source, page, text, embedding) VALUES (?, ?, ?, ?)').run(
      'bio.pdf',
      1,
      'existing text',
      toBlob(new Float32Array([1, 0, 0]))
    );
  });

  const rows = () =>
    db.prepare('SELECT text FROM chunks WHERE source = ?').all('bio.pdf') as { text: string }[];

  test('keeps the existing rows when the embedding request fails', async () => {
    vi.mocked(embed).mockRejectedValueOnce(new Error('embeddings request failed: 429 rate limited'));
    await expect(writeChunks(db, 'bio.pdf', [{ page: 1, text: 'new text' }], true)).rejects.toThrow(
      /429/
    );
    expect(rows()).toEqual([{ text: 'existing text' }]);
  });

  test('keeps the existing rows when the embedding count does not match', async () => {
    vi.mocked(embed).mockResolvedValueOnce([]);
    await expect(writeChunks(db, 'bio.pdf', [{ page: 1, text: 'new text' }], true)).rejects.toThrow(
      /mismatch/
    );
    expect(rows()).toEqual([{ text: 'existing text' }]);
  });

  test('replaces the rows for a forced source once the embeddings resolve', async () => {
    vi.mocked(embed).mockResolvedValueOnce([new Float32Array([0, 1, 0])]);
    await writeChunks(db, 'bio.pdf', [{ page: 4, text: 'new text' }], true);
    expect(rows()).toEqual([{ text: 'new text' }]);
  });

  test('leaves other sources untouched when forcing a re-ingest', async () => {
    db.prepare('INSERT INTO chunks (source, page, text, embedding) VALUES (?, ?, ?, ?)').run(
      'chem.pdf',
      1,
      'other source',
      toBlob(new Float32Array([0, 0, 1]))
    );
    vi.mocked(embed).mockResolvedValueOnce([new Float32Array([0, 1, 0])]);
    await writeChunks(db, 'bio.pdf', [{ page: 4, text: 'new text' }], true);
    expect(
      db.prepare('SELECT text FROM chunks WHERE source = ?').all('chem.pdf')
    ).toEqual([{ text: 'other source' }]);
  });
});
