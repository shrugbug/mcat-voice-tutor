import type { DB } from './db';

export type Hit = { source: string; page: number | null; text: string; score: number };

const SEP = '\n\n';

/** Split a paragraph that is longer than `max` into fixed-size pieces. */
function splitParagraph(paragraph: string, max: number): string[] {
  if (paragraph.length <= max) return [paragraph];
  const pieces: string[] = [];
  for (let i = 0; i < paragraph.length; i += max) pieces.push(paragraph.slice(i, i + max));
  return pieces;
}

export function chunkText(text: string, size = 1400, overlap = 200): string[] {
  const ov = Math.max(0, Math.min(overlap, Math.floor(size / 2)));
  const maxPiece = Math.max(1, size - ov - SEP.length);
  const paragraphs = text
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let buf = '';
  let hasContent = false;

  const flush = () => {
    if (!hasContent) return;
    const chunk = buf.trim();
    chunks.push(chunk);
    buf = ov > 0 ? chunk.slice(-ov) : '';
    hasContent = false;
  };

  for (const paragraph of paragraphs) {
    for (const piece of splitParagraph(paragraph, maxPiece)) {
      if (buf && buf.length + SEP.length + piece.length > size) flush();
      buf = buf ? buf + SEP + piece : piece;
      hasContent = true;
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
