/**
 * Rebuilds data/combined.db from the snapshots pulled by scripts/pull-remote.sh.
 * Rebuilt from scratch every run, never incrementally, so a bad run cannot poison the next one.
 */
import { existsSync, rmSync } from 'node:fs';
import { openDb } from '../lib/db';
import { combineInto } from '../lib/combine';

const SOURCES = [
  { source: 'prod', path: 'data/remote/prod.db' },
  { source: 'demo', path: 'data/remote/demo.db' },
];
const TARGET = 'data/combined.db';

function main(): void {
  const missing = SOURCES.filter((s) => !existsSync(s.path));
  if (missing.length > 0) {
    throw new Error(`Missing snapshot(s): ${missing.map((m) => m.path).join(', ')}. Run \`npm run pull\` first.`);
  }

  for (const suffix of ['', '-wal', '-shm']) {
    if (existsSync(TARGET + suffix)) rmSync(TARGET + suffix);
  }

  const target = openDb(TARGET);
  const opened = SOURCES.map((s) => ({ source: s.source, db: openDb(s.path) }));

  try {
    const report = combineInto(target, opened);
    console.log(`Combined -> ${TARGET}`);
    for (const [table, count] of Object.entries(report)) {
      console.log(`  ${table.padEnd(14)} ${count}`);
    }
  } finally {
    for (const { db } of opened) db.close();
    target.close();
  }
}

main();
