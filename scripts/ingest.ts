import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, realpathSync } from 'node:fs';
import { basename, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { openDb, type DB } from '../lib/db';
import { chunkText, toBlob } from '../lib/rag';
import { embed } from '../lib/embeddings';

const DB_PATH = process.env.MCAT_DB ?? 'data/mcat.db';

function requirePdftotext(): void {
  try {
    execFileSync('pdftotext', ['-v'], { stdio: 'pipe' });
  } catch {
    throw new Error('pdftotext not found. Install poppler first: brew install poppler');
  }
}

/** Extract one string per PDF page using poppler's form-feed page separator. */
export function extractPages(file: string): string[] {
  try {
    const out = execFileSync('pdftotext', ['-layout', file, '-'], {
      encoding: 'utf8',
      maxBuffer: 512 * 1024 * 1024,
      // Poppler emits font warnings on stderr for many real PDFs; keep them out of the report
      // but surface them if extraction actually fails.
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return out.split('\f');
  } catch (err) {
    const stderr = (err as { stderr?: Buffer | string }).stderr?.toString().trim();
    throw new Error(`pdftotext failed on ${file}${stderr ? `: ${stderr}` : ''}`);
  }
}

export type PageChunk = { page: number; text: string };

/**
 * Embed every chunk before touching the database, then swap the source's rows in one transaction,
 * so a failed or short embedding response can never destroy rows that are already valid.
 */
export async function writeChunks(
  db: DB,
  source: string,
  chunks: PageChunk[],
  force: boolean
): Promise<void> {
  // Guard: with force=true this function deletes the source's existing rows before inserting
  // the new ones. If extraction/chunking produced zero chunks (e.g. a corrupt PDF, a pdftotext
  // regression, or an empty file), that delete would erase a previously valid index and replace
  // it with nothing. Abort before the delete/embed happens at all.
  if (force && chunks.length === 0) {
    throw new Error(`${source}: extraction produced 0 chunks, refusing to --force-replace an existing index`);
  }

  const vectors = await embed(chunks.map((c) => c.text));
  if (vectors.length !== chunks.length) {
    throw new Error(
      `${source}: embedding count mismatch (${vectors.length} vectors for ${chunks.length} chunks)`
    );
  }

  const remove = db.prepare('DELETE FROM chunks WHERE source = ?');
  const insert = db.prepare(
    'INSERT INTO chunks (source, page, text, embedding) VALUES (?, ?, ?, ?)'
  );
  const replaceSource = db.transaction((rows: PageChunk[]) => {
    if (force) remove.run(source);
    rows.forEach((row, i) => insert.run(source, row.page, row.text, toBlob(vectors[i])));
  });
  replaceSource(chunks);
}

function chunkPages(pages: string[]): PageChunk[] {
  const chunks: PageChunk[] = [];
  pages.forEach((pageText, i) => {
    for (const text of chunkText(pageText)) chunks.push({ page: i + 1, text });
  });
  return chunks;
}

async function main(argv: string[]): Promise<void> {
  const force = argv.includes('--force');
  const dryRun = argv.includes('--dry-run');
  const files = argv.filter((a) => !a.startsWith('--'));

  if (files.length === 0) {
    console.error('usage: npm run ingest -- [--force] [--dry-run] pdfs/*.pdf');
    process.exitCode = 1;
    return;
  }

  requirePdftotext();

  let db: ReturnType<typeof openDb> | null = null;
  if (!dryRun) {
    mkdirSync(dirname(DB_PATH), { recursive: true });
    db = openDb(DB_PATH);
  }

  for (const file of files) {
    if (!existsSync(file)) {
      console.error(`skip ${file}: file not found`);
      continue;
    }
    const source = basename(file);

    if (db && !force) {
      const existing = db
        .prepare('SELECT COUNT(*) AS n FROM chunks WHERE source = ?')
        .get(source) as { n: number };
      if (existing.n > 0) {
        console.log(`${source}: already ingested (${existing.n} chunks), use --force to re-ingest`);
        continue;
      }
    }

    const pages = extractPages(file);
    const chunks = chunkPages(pages);
    const chars = chunks.reduce((sum, c) => sum + c.text.length, 0);
    console.log(`${source}: ${pages.length} pages, ${chunks.length} chunks, ${chars} chars`);

    // Guard: with --force, writeChunks deletes the source's existing rows before inserting the
    // new ones. If extraction/chunking produced zero chunks (e.g. a corrupt PDF, pdftotext
    // regression, or an empty file), that delete would erase a previously valid index and
    // replace it with nothing. Abort this file before any delete happens.
    if (force && chunks.length === 0) {
      console.error(`skip ${source}: extraction produced 0 chunks, refusing to --force-replace an existing index`);
      process.exitCode = 1;
      continue;
    }

    if (!db) continue;

    await writeChunks(db, source, chunks, force);
    console.log(`${source}: inserted ${chunks.length} chunks`);
  }

  if (dryRun) console.log('dry run: no embeddings requested, nothing written to the database');
  db?.close();
}

/** True only when this file is the process entry point, so tests can import it safely. */
function runAsCli(): boolean {
  const entry = process.argv[1];
  if (!entry) return false;
  try {
    return realpathSync(entry) === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (runAsCli()) {
  main(process.argv.slice(2)).catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
