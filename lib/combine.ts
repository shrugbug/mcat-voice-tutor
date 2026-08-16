import type { DB } from './db';

/**
 * Row-bearing tables copied into the combined db, each gaining `source` and `orig_id`.
 * `chunks` is deliberately excluded: embeddings are not tuning input.
 */
export const COMBINED_TABLES = [
  'results',
  'episodes',
  'transcripts',
  'feedback',
  'sessions',
  'tool_errors',
] as const;

export type CombineReport = Record<string, number>;

export interface CombineSource {
  source: string;
  db: DB;
}

function tableExists(db: DB, table: string): boolean {
  return (
    db.prepare("SELECT COUNT(*) AS n FROM sqlite_master WHERE type='table' AND name=?").get(table) as {
      n: number;
    }
  ).n > 0;
}

function columnsOf(db: DB, table: string): string[] {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).map((c) => c.name);
}

/**
 * Rebuilds `target` from `sources`. Ids are reassigned rather than preserved -- the two instances'
 * autoincrement ranges overlap, so merging on id would silently collide. `(source, orig_id)` is
 * the stable key.
 *
 * `categories` comes from the source named `prod` only: mastery and due_at are per-instance student
 * state, and the demo instance's values describe nobody.
 */
export function combineInto(target: DB, sources: CombineSource[]): CombineReport {
  const prodSource = sources.find(({ source }) => source === 'prod');
  if (!prodSource) {
    throw new Error("Cannot combine databases without a source named 'prod'.");
  }

  const report: CombineReport = {};

  for (const table of COMBINED_TABLES) {
    if (!tableExists(target, table)) continue;
    const targetCols = columnsOf(target, table);
    if (!targetCols.includes('source')) {
      target.exec(`ALTER TABLE ${table} ADD COLUMN source TEXT`);
    }
    if (!columnsOf(target, table).includes('orig_id')) {
      target.exec(`ALTER TABLE ${table} ADD COLUMN orig_id INTEGER`);
    }
    target.exec(`DELETE FROM ${table}`);
    report[table] = 0;
  }

  target.exec('DELETE FROM categories');

  const copy = target.transaction(() => {
    if (tableExists(prodSource.db, 'categories')) {
      const cats = prodSource.db.prepare('SELECT * FROM categories').all() as Record<string, unknown>[];
      const cols = columnsOf(target, 'categories').filter((c) => c in (cats[0] ?? {}));
      if (cats.length > 0) {
        const stmt = target.prepare(
          `INSERT INTO categories (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
        );
        for (const row of cats) stmt.run(cols.map((c) => row[c]));
      }
    }

    for (const { source, db } of sources) {
      for (const table of COMBINED_TABLES) {
        if (!tableExists(db, table) || !tableExists(target, table)) continue;

        const rows = db.prepare(`SELECT * FROM ${table}`).all() as Record<string, unknown>[];
        if (rows.length === 0) continue;

        const shared = columnsOf(target, table).filter(
          (c) => c !== 'id' && c !== 'source' && c !== 'orig_id' && c in rows[0]
        );
        const cols = [...shared, 'source', 'orig_id'];
        const stmt = target.prepare(
          `INSERT INTO ${table} (${cols.join(',')}) VALUES (${cols.map(() => '?').join(',')})`
        );

        for (const row of rows) {
          stmt.run([...shared.map((c) => row[c]), source, row.id as number]);
        }
        report[table] = (report[table] ?? 0) + rows.length;
      }
    }
  });

  copy();
  return report;
}
