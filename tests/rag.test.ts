import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb } from '../lib/db';
import { chunkText, cosine, fromBlob, searchMaterials, toBlob } from '../lib/rag';
import { embed } from '../lib/embeddings';
import type Database from 'better-sqlite3';

function paragraphs(count: number, chars: number): string {
  return Array.from({ length: count }, (_, i) =>
    `${String(i).padStart(3, '0')} `.padEnd(chars, 'x')
  ).join('\n\n');
}

describe('chunkText', () => {
  test('returns one chunk when the whole text fits within size', () => {
    const text = 'Enzyme kinetics.\n\nMichaelis-Menten.';
    expect(chunkText(text, 1400, 200)).toEqual(['Enzyme kinetics.\n\nMichaelis-Menten.']);
  });

  test('returns no chunks for empty or whitespace-only text', () => {
    expect(chunkText('', 1400, 200)).toEqual([]);
    expect(chunkText('   \n\n  \n', 1400, 200)).toEqual([]);
  });

  test('no chunk exceeds size', () => {
    const chunks = chunkText(paragraphs(40, 300), 1400, 200);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1400);
  });

  test('keeps paragraphs intact when each paragraph fits within size', () => {
    const size = 1400;
    const overlap = 200;
    const source = paragraphs(30, 300);
    const originals = new Set(source.split('\n\n'));
    const chunks = chunkText(source, size, overlap);
    for (const chunk of chunks) {
      // The first paragraph of a non-initial chunk is the carried overlap tail, so skip it.
      const paras = chunk.split('\n\n');
      const body = chunks.indexOf(chunk) === 0 ? paras : paras.slice(1);
      for (const p of body) expect(originals.has(p)).toBe(true);
    }
  });

  test('carries the previous chunk overlap tail into the next chunk', () => {
    const overlap = 200;
    const chunks = chunkText(paragraphs(40, 300), 1400, overlap);
    expect(chunks.length).toBeGreaterThan(2);
    for (let i = 0; i < chunks.length - 1; i++) {
      const tail = chunks[i].slice(-overlap).trimStart();
      expect(tail.length).toBeGreaterThan(0);
      expect(chunks[i + 1].startsWith(tail)).toBe(true);
    }
  });

  test('hard-splits a single paragraph longer than size', () => {
    const long = 'y'.repeat(5000);
    const chunks = chunkText(long, 1400, 200);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(1400);
    expect(chunks.join('').replace(/\s+/g, '').length).toBeGreaterThanOrEqual(5000);
  });

  test('keeps a paragraph of exactly size chars whole', () => {
    const size = 1400;
    const exact = 'z'.repeat(size);
    expect(chunkText(exact, size, 200)).toEqual([exact]);
  });

  test('keeps an exactly-size paragraph whole when it follows another paragraph', () => {
    const size = 1400;
    const exact = 'z'.repeat(size);
    const chunks = chunkText(`intro paragraph\n\n${exact}`, size, 200);
    expect(chunks).toContain(exact);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(size);
  });

  test('splits a paragraph only once it exceeds size', () => {
    const size = 1400;
    expect(chunkText('z'.repeat(size + 1), size, 200).length).toBeGreaterThan(1);
  });

  test('respects size for tiny size/overlap values', () => {
    const chunks = chunkText('a'.repeat(50), 10, 2);
    expect(chunks.length).toBeGreaterThan(1);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(10);
  });

  test('rejects an overlap that leaves no room inside size', () => {
    expect(() => chunkText('abc', 10, 8)).toThrow(/overlap/);
    expect(() => chunkText('abc', 10, 20)).toThrow(/overlap/);
    expect(() => chunkText('abc', 0, 0)).toThrow(/size/);
  });
});

describe('cosine', () => {
  test('is 1 for identical direction regardless of magnitude', () => {
    expect(cosine(new Float32Array([2, 0, 0]), new Float32Array([1, 0, 0]))).toBeCloseTo(1);
  });

  test('is 0 for orthogonal vectors', () => {
    expect(cosine(new Float32Array([1, 0, 0]), new Float32Array([0, 1, 0]))).toBeCloseTo(0);
  });

  test('is 0 when either vector is all zeros', () => {
    expect(cosine(new Float32Array([0, 0, 0]), new Float32Array([1, 0, 0]))).toBe(0);
  });
});

describe('embedding blob storage', () => {
  test('a vector stored with toBlob and read back with fromBlob is unchanged', () => {
    const vector = new Float32Array([0.25, -0.5, 0.125, 1]);
    expect(Array.from(fromBlob(toBlob(vector)))).toEqual(Array.from(vector));
  });

  test('a vector written to the chunks table is searchable with score ~1', () => {
    const db = openDb(':memory:');
    const vector = new Float32Array([0.6, 0.8, 0]);
    db.prepare('INSERT INTO chunks (source, page, text, embedding) VALUES (?, ?, ?, ?)').run(
      'ingested.pdf',
      7,
      'glycolysis',
      toBlob(vector)
    );
    const hits = searchMaterials(db, vector, 1);
    expect(hits[0]).toMatchObject({ source: 'ingested.pdf', page: 7, text: 'glycolysis' });
    expect(hits[0].score).toBeCloseTo(1);
  });
});

describe('searchMaterials', () => {
  let db: Database.Database;

  const rows = [
    { source: 'bio.pdf', page: 1, text: 'enzyme kinetics', vec: [1, 0, 0] },
    { source: 'chem.pdf', page: 2, text: 'acid base equilibria', vec: [0, 1, 0] },
    { source: 'psych.pdf', page: 3, text: 'operant conditioning', vec: [0, 0, 1] },
  ];

  beforeEach(() => {
    db = openDb(':memory:');
    const insert = db.prepare(
      'INSERT INTO chunks (source, page, text, embedding) VALUES (?, ?, ?, ?)'
    );
    for (const r of rows) {
      const f32 = new Float32Array(r.vec);
      insert.run(r.source, r.page, r.text, Buffer.from(f32.buffer));
    }
  });

  test('returns the chunk whose embedding matches the query with score ~1', () => {
    const hits = searchMaterials(db, new Float32Array([1, 0, 0]), 5);
    expect(hits[0].source).toBe('bio.pdf');
    expect(hits[0].page).toBe(1);
    expect(hits[0].text).toBe('enzyme kinetics');
    expect(hits[0].score).toBeCloseTo(1);
  });

  test('scores orthogonal chunks at ~0 and ranks them below the match', () => {
    const hits = searchMaterials(db, new Float32Array([0, 1, 0]), 5);
    expect(hits[0].source).toBe('chem.pdf');
    expect(hits.slice(1).map((h) => h.score)).toEqual([0, 0]);
  });

  test('orders results by descending score', () => {
    const hits = searchMaterials(db, new Float32Array([0.9, 0.4, 0]), 3);
    expect(hits.map((h) => h.source)).toEqual(['bio.pdf', 'chem.pdf', 'psych.pdf']);
    const scores = hits.map((h) => h.score);
    expect(scores[0]).toBeGreaterThan(scores[1]);
    expect(scores[1]).toBeGreaterThan(scores[2]);
  });

  test('returns at most k results and defaults to 5', () => {
    expect(searchMaterials(db, new Float32Array([1, 0, 0]), 2)).toHaveLength(2);
    expect(searchMaterials(db, new Float32Array([1, 0, 0]))).toHaveLength(3);
  });

  test('returns an empty array when there are no chunks', () => {
    const empty = openDb(':memory:');
    expect(searchMaterials(empty, new Float32Array([1, 0, 0]))).toEqual([]);
  });
});

describe('embed', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  test('throws when OPENAI_API_KEY is missing', async () => {
    vi.stubEnv('OPENAI_API_KEY', '');
    await expect(embed(['hello'])).rejects.toThrow(/OPENAI_API_KEY/);
  });

  test('returns no vectors and makes no request for an empty input', async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);
    await expect(embed([])).resolves.toEqual([]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  test('batches inputs in groups of at most 100 and preserves order', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    const seen: string[][] = [];
    const fetchMock = vi.fn(async (_url: string, init: { body: string }) => {
      const body = JSON.parse(init.body) as { input: string[] };
      seen.push(body.input);
      return {
        ok: true,
        json: async () => ({
          data: body.input.map((t, i) => ({ index: i, embedding: [Number(t), 0, 0] })),
        }),
      };
    });
    vi.stubGlobal('fetch', fetchMock);

    const inputs = Array.from({ length: 150 }, (_, i) => String(i));
    const vectors = await embed(inputs);

    expect(seen.map((b) => b.length)).toEqual([100, 50]);
    expect(vectors).toHaveLength(150);
    expect(vectors[0]).toBeInstanceOf(Float32Array);
    expect(vectors.map((v) => v[0])).toEqual(inputs.map(Number));
  });

  test('throws with the API status when the request fails', async () => {
    const sentinel = 'PRIVATE_EMBEDDING_INPUT_42';
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 429, text: async () => sentinel }))
    );
    let message = '';
    try {
      await embed(['hi']);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('429');
    expect(message).not.toContain(sentinel);
  });
});
