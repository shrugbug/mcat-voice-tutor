/**
 * Imports an AAMC full-length score report CSV into the student model.
 *
 *   npm run import-exam -- <csv> --exam AAMC-FL4 [--db path] [--apply]
 *
 * Dry-run by default: prints what it would change and writes nothing. Pass --apply to commit.
 * Re-running with the same --exam id replaces that exam's rows rather than duplicating them.
 */
import { readFileSync } from 'node:fs';
import { openDb } from '../lib/db';
import { buildNote, parseCsv, shrunkMastery, toExamRow, type ExamRow } from '../lib/exam-import';

interface Args {
  csvPath: string;
  examId: string;
  dbPath: string | undefined;
  apply: boolean;
}

function parseArgs(argv: string[]): Args {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  const flag = (name: string): string | undefined => {
    const index = argv.indexOf(name);
    return index === -1 ? undefined : argv[index + 1];
  };

  const csvPath = positional[0];
  if (!csvPath) throw new Error('Usage: import-exam <csv> --exam <id> [--db <path>] [--apply]');

  const examId = flag('--exam');
  if (!examId) throw new Error('--exam <id> is required (it is the provenance key for re-runs).');

  return { csvPath, examId, dbPath: flag('--db'), apply: argv.includes('--apply') };
}

function main(): void {
  const { csvPath, examId, dbPath, apply } = parseArgs(process.argv.slice(2));

  const parsed = parseCsv(readFileSync(csvPath, 'utf8'));
  const rows: ExamRow[] = [];
  const skipped: Record<string, string>[] = [];

  for (const raw of parsed) {
    const row = toExamRow(raw);
    if (row) rows.push(row);
    else skipped.push(raw);
  }

  console.log(`Parsed ${parsed.length} CSV rows -> ${rows.length} importable, ${skipped.length} skipped.`);
  if (skipped.length > 0) {
    // Loud, because a silent skip means a category quietly receives no evidence.
    console.log('Skipped rows (no resolvable category or difficulty):');
    for (const raw of skipped.slice(0, 10)) {
      console.log(`  q${raw.Question} section=${raw.Section?.slice(0, 30)} cat=${raw.Content_Category_Code}`);
    }
  }

  const db = openDb(dbPath);

  try {
    const known = new Set<string>(
      db.prepare('SELECT id FROM categories').all().map((r) => (r as { id: string }).id)
    );
    const unknown = [...new Set(rows.map((r) => r.categoryId))].filter((id) => !known.has(id));
    if (unknown.length > 0) {
      throw new Error(
        `Report references categories absent from the taxonomy: ${unknown.join(', ')}. ` +
          'Run `npm run seed -- --taxonomy-only` first, or fix the mapping.'
      );
    }

    const existing = db
      .prepare("SELECT COUNT(*) AS n FROM results WHERE mode = 'exam_import' AND note LIKE ?")
      .get(`${examId} %`) as { n: number };

    console.log(`\nTarget db: ${dbPath ?? process.env.MCAT_DB ?? 'data/mcat.db'}`);
    console.log(`Existing rows for ${examId}: ${existing.n}${existing.n > 0 ? ' (will be replaced)' : ''}`);

    const apply_ = db.transaction(() => {
      db.prepare("DELETE FROM results WHERE mode = 'exam_import' AND note LIKE ?").run(`${examId} %`);

      const insert = db.prepare(
        `INSERT INTO results (category_id, difficulty, correct, error_type, mode, note)
         VALUES (?, ?, ?, NULL, 'exam_import', ?)`
      );
      for (const row of rows) {
        insert.run(row.categoryId, row.difficulty, row.correct ? 1 : 0, buildNote(examId, row));
      }

      // Recompute from ALL results, not just this import, so the formula stays idempotent and
      // still reflects any questions the examiner asked in-app.
      const totals = db
        .prepare(
          `SELECT category_id, COUNT(*) AS n, SUM(correct) AS correct
           FROM results GROUP BY category_id`
        )
        .all() as { category_id: string; n: number; correct: number }[];

      const update = db.prepare('UPDATE categories SET mastery = ?, attempts = ? WHERE id = ?');
      for (const t of totals) {
        update.run(shrunkMastery(t.correct, t.n), t.n, t.category_id);
      }
      return totals.length;
    });

    if (!apply) {
      console.log('\nDRY RUN -- nothing written. Re-run with --apply to commit.');
      const preview = new Map<string, { n: number; correct: number }>();
      for (const row of rows) {
        const cur = preview.get(row.categoryId) ?? { n: 0, correct: 0 };
        cur.n += 1;
        cur.correct += row.correct ? 1 : 0;
        preview.set(row.categoryId, cur);
      }
      const sorted = [...preview.entries()].sort(
        (a, b) => shrunkMastery(a[1].correct, a[1].n) - shrunkMastery(b[1].correct, b[1].n)
      );
      console.log('\nWould set mastery (weakest first):');
      for (const [id, { n, correct }] of sorted) {
        console.log(`  ${id.padEnd(20)} ${correct}/${n}  -> ${shrunkMastery(correct, n).toFixed(3)}`);
      }
      return;
    }

    const touched = apply_();
    console.log(`\nApplied: ${rows.length} result rows, ${touched} categories re-scored.`);
  } finally {
    db.close();
  }
}

main();
