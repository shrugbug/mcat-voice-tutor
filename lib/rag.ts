import type { DB } from './db';

export type Hit = { source: string; page: number | null; text: string; score: number };

const SEP = '\n\n';

/**
 * Split a paragraph only when it exceeds `size`. Oversized paragraphs are cut into `maxPiece`
 * chars so a piece still fits alongside a carried overlap tail.
 */
function splitParagraph(paragraph: string, size: number, maxPiece: number): string[] {
  if (paragraph.length <= size) return [paragraph];
  const pieces: string[] = [];
  for (let i = 0; i < paragraph.length; i += maxPiece) pieces.push(paragraph.slice(i, i + maxPiece));
  return pieces;
}

export function chunkText(text: string, size = 1400, overlap = 200): string[] {
  if (!Number.isInteger(size) || size <= 0) {
    throw new Error(`chunkText: size must be a positive integer, got ${size}`);
  }
  if (!Number.isInteger(overlap) || overlap < 0) {
    throw new Error(`chunkText: overlap must be a non-negative integer, got ${overlap}`);
  }
  if (overlap + SEP.length >= size) {
    throw new Error(
      `chunkText: overlap (${overlap}) plus the ${SEP.length}-char separator must leave room inside size (${size})`
    );
  }

  const maxPiece = size - overlap - SEP.length;
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let buf = '';
  let carry = '';

  const flush = () => {
    if (!buf) return;
    const chunk = buf.trim();
    chunks.push(chunk);
    carry = overlap > 0 ? chunk.slice(-overlap) : '';
    buf = '';
  };

  for (const paragraph of paragraphs) {
    for (const piece of splitParagraph(paragraph, size, maxPiece)) {
      if (buf && buf.length + SEP.length + piece.length > size) flush();
      if (buf) {
        buf += SEP + piece;
      } else {
        // The overlap tail is only worth carrying if the piece still fits behind it.
        buf = carry && carry.length + SEP.length + piece.length <= size ? carry + SEP + piece : piece;
      }
    }
  }
  flush();
  return chunks;
}

export function cosine(a: Float32Array, b: Float32Array): number {
  let dot = 0;
  let na = 0;
  let nb = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    na += a[i] * a[i];
    nb += b[i] * b[i];
  }
  if (na === 0 || nb === 0) return 0;
  return dot / (Math.sqrt(na) * Math.sqrt(nb));
}

export function toBlob(vector: Float32Array): Buffer {
  return Buffer.from(vector.buffer, vector.byteOffset, vector.byteLength);
}

export function fromBlob(blob: Buffer): Float32Array {
  return new Float32Array(blob.buffer, blob.byteOffset, blob.length / 4);
}

export function searchMaterials(db: DB, queryEmbedding: Float32Array, k = 5): Hit[] {
  const rows = db
    .prepare('SELECT source, page, text, embedding FROM chunks')
    .all() as { source: string; page: number | null; text: string; embedding: Buffer }[];

  return rows
    .map((r) => ({
      source: r.source,
      page: r.page,
      text: r.text,
      score: cosine(queryEmbedding, fromBlob(r.embedding)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k);
}
