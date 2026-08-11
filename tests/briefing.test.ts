import { beforeEach, describe, expect, test } from 'vitest';
import RawDatabase from 'better-sqlite3';
import { openDb } from '../lib/db';
import { seedTaxonomy, seedSectionScores, recordResult, type Taxonomy } from '../lib/student';
import { buildBriefing } from '../lib/briefing';
import type Database from 'better-sqlite3';

/**
 * openDb() now always creates categories.due_at/interval_days and the episodes table (WS-A
 * merged into lib/db.ts). To genuinely exercise lib/briefing.ts's tolerance branches for older
 * db files that predate WS-A, build that old schema directly instead of going through openDb().
 * Mirrors lib/db.ts's categories/results/sessions shapes minus due_at/interval_days, no episodes.
 */
function openPreWsADb(): Database.Database {
  const db = new RawDatabase(':memory:');
  db.exec(`
    CREATE TABLE categories(
      id TEXT PRIMARY KEY, section TEXT NOT NULL, name TEXT NOT NULL,
      topics TEXT NOT NULL DEFAULT '[]',
      mastery REAL NOT NULL DEFAULT 0.5, attempts INTEGER NOT NULL DEFAULT 0);
    CREATE TABLE results(
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')),
      category_id TEXT NOT NULL, difficulty INTEGER NOT NULL, correct INTEGER NOT NULL,
      error_type TEXT, mode TEXT NOT NULL, note TEXT);
    CREATE TABLE sessions(
      id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')),
      mode TEXT NOT NULL, summary TEXT NOT NULL, focus_next TEXT NOT NULL);
  `);
  return db;
}

const tax: Taxonomy = {
  sections: [
    {
      id: 'chem_phys',
      name: 'CP',
      categories: [
        { id: '4A', name: 'Motion', topics: ['Kinematics'] },
        { id: '4B', name: 'Fluids', topics: ['Bernoulli'] },
        { id: '5A', name: 'Thermo', topics: ['Gibbs'] },
      ],
    },
  ],
};

function futureDate(daysFromNow: number): string {
  const d = new Date(Date.now() + daysFromNow * 86_400_000);
  return d.toISOString().slice(0, 10);
}

function insertYesterdayResult(db: Database.Database, categoryId: string, correct: boolean): void {
  db.prepare(
    `INSERT INTO results (ts, category_id, difficulty, correct, mode)
     VALUES (datetime('now', '-1 day'), ?, 1, ?, 'drill')`
  ).run(categoryId, correct ? 1 : 0);
}

describe('buildBriefing (no WS-A schema: no due_at, no episodes)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openPreWsADb();
    seedTaxonomy(db, tax);
    seedSectionScores(db, { chem_phys: 129 });
  });

  test('reports days to exam from examDate', () => {
    const md = buildBriefing(db, futureDate(10));
    expect(md).toMatch(/\*\*10 days to exam\*\*/);
  });

  test('reports exam passed when examDate is in the past', () => {
    const md = buildBriefing(db, futureDate(-3));
    expect(md).toMatch(/has passed/);
  });

  test('lists up to 5 weakest categories ordered by mastery ascending', () => {
    const md = buildBriefing(db, futureDate(5));
    const idx4A = md.indexOf('Motion (4A)');
    expect(idx4A).toBeGreaterThan(-1);
    expect(md).toContain('## Weakest categories');
  });

  test('gracefully notes due_at tracking is unavailable when column absent', () => {
    const md = buildBriefing(db, futureDate(5));
    expect(md).toContain('Spaced-repetition tracking not yet available (WS-A pending)');
  });

  test('gracefully notes episodic memory is unavailable when episodes table absent', () => {
    const md = buildBriefing(db, futureDate(5));
    expect(md).toContain('Episodic memory not yet available (WS-A pending)');
  });

  test('reports no questions attempted yesterday when results table is empty', () => {
    const md = buildBriefing(db, futureDate(5));
    expect(md).toContain('No questions attempted yesterday.');
  });

  test("yesterday's session count and accuracy reflect results from results table", () => {
    insertYesterdayResult(db, '4A', true);
    insertYesterdayResult(db, '4A', true);
    insertYesterdayResult(db, '4B', false);
    const md = buildBriefing(db, futureDate(5));
    expect(md).toMatch(/3 questions attempted, 67% accuracy\./);
  });

  test("today's plan always includes at least one concrete block", () => {
    const md = buildBriefing(db, futureDate(5));
    expect(md).toMatch(/## Today's plan\n- Block 1 \(20 min\): Drill/);
  });

  test('names at most the top two open bugs when supplied', () => {
    const md = buildBriefing(db, futureDate(5), ['First bug', 'Second bug', 'Third bug']);
    expect(md).toContain('## Open bugs');
    expect(md).toContain('- First bug');
    expect(md).toContain('- Second bug');
    expect(md).not.toContain('Third bug');
  });

  test('returns fallback plan text when no categories are seeded', () => {
    const empty = openPreWsADb();
    const md = buildBriefing(empty, futureDate(5));
    expect(md).toContain('No categories seeded yet — run `npm run seed` before the next session.');
  });
});

describe('buildBriefing (with WS-A schema: due_at + episodes present)', () => {
  let db: Database.Database;

  beforeEach(() => {
    // openDb() now always creates categories.due_at/interval_days and the episodes table
    // (WS-A merged into lib/db.ts) — no manual schema simulation needed anymore.
    db = openDb(':memory:');
    seedTaxonomy(db, tax);
    seedSectionScores(db, { chem_phys: 129 });
  });

  test('due categories section lists categories with NULL due_at (never reviewed) as due', () => {
    const md = buildBriefing(db, futureDate(5));
    expect(md).toContain('## Due for review');
    expect(md).not.toContain('Spaced-repetition tracking not yet available');
    expect(md).toMatch(/Motion \(4A\)|Fluids \(4B\)|Thermo \(5A\)/);
  });

  test('due categories section excludes categories with a future due_at', () => {
    db.prepare(`UPDATE categories SET due_at = datetime('now', '+5 days') WHERE id = '4A'`).run();
    db.prepare(`UPDATE categories SET due_at = datetime('now', '-1 day') WHERE id = '4B'`).run();
    db.prepare(`UPDATE categories SET due_at = datetime('now', '-1 day') WHERE id = '5A'`).run();
    const md = buildBriefing(db, futureDate(5));
    const dueSection = md.slice(md.indexOf('## Due for review'), md.indexOf('## Yesterday'));
    expect(dueSection).not.toContain('Motion (4A)');
    expect(dueSection).toContain('Fluids (4B)');
  });

  test('recent misconceptions section reports up to 2 most recent, most-recent first', () => {
    db.prepare(
      `INSERT INTO episodes (ts, category_id, stem, options_json, correct_index, chosen_index, misconception) VALUES (datetime('now', '-3 hours'), '4A', 'stem', '[]', 0, 0, 'Confused impulse with momentum')`
    ).run();
    db.prepare(
      `INSERT INTO episodes (ts, category_id, stem, options_json, correct_index, chosen_index, misconception) VALUES (datetime('now', '-2 hours'), '4B', 'stem', '[]', 0, 0, 'Applied Bernoulli without steady flow')`
    ).run();
    db.prepare(
      `INSERT INTO episodes (ts, category_id, stem, options_json, correct_index, chosen_index, misconception) VALUES (datetime('now', '-1 hours'), '5A', 'stem', '[]', 0, 0, 'Mixed up entropy sign convention')`
    ).run();
    const md = buildBriefing(db, futureDate(5));
    const section = md.slice(md.indexOf('## Recent misconceptions'), md.indexOf("## Today's plan"));
    expect(section).toContain('5A: Mixed up entropy sign convention');
    expect(section).toContain('4B: Applied Bernoulli without steady flow');
    expect(section).not.toContain('4A: Confused impulse with momentum');
  });

  test('episodes with null misconception are excluded', () => {
    db.prepare(
      `INSERT INTO episodes (ts, category_id, stem, options_json, correct_index, chosen_index, misconception) VALUES (datetime('now'), '4A', 'stem', '[]', 0, 0, NULL)`
    ).run();
    const md = buildBriefing(db, futureDate(5));
    const section = md.slice(md.indexOf('## Recent misconceptions'), md.indexOf("## Today's plan"));
    expect(section).toContain('None recorded recently.');
  });

  test("today's plan prefers a due category for block 1 when one exists", () => {
    db.prepare(`UPDATE categories SET due_at = datetime('now', '-1 day') WHERE id = '4B'`).run();
    db.prepare(`UPDATE categories SET due_at = datetime('now', '+5 days') WHERE id = '4A'`).run();
    db.prepare(`UPDATE categories SET due_at = datetime('now', '+5 days') WHERE id = '5A'`).run();
    const md = buildBriefing(db, futureDate(5));
    const planSection = md.slice(md.indexOf("## Today's plan"));
    expect(planSection).toMatch(/Block 1 \(20 min\): Drill Fluids \(4B\).*due for review/);
  });
});

describe('buildBriefing recordResult integration', () => {
  test('mastery changes from recordResult are reflected in the weakest ordering', () => {
    const db = openDb(':memory:');
    seedTaxonomy(db, tax);
    seedSectionScores(db, { chem_phys: 129 });
    for (let i = 0; i < 5; i++) {
      recordResult(db, { categoryId: '4A', difficulty: 3, correct: false, mode: 'drill' });
    }
    const md = buildBriefing(db, futureDate(5));
    const weakestSection = md.slice(md.indexOf('## Weakest categories'), md.indexOf('## Due for review'));
    expect(weakestSection).toMatch(/1\. Motion \(4A\)/);
  });
});
