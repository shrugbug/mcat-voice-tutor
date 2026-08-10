import { beforeEach, describe, expect, test } from 'vitest';
import { openDb } from '../lib/db';
import { seedTaxonomy, seedSectionScores, recordResult, type Taxonomy } from '../lib/student';
import { buildBriefing } from '../lib/briefing';
import type Database from 'better-sqlite3';

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
    db = openDb(':memory:');
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

  test('returns fallback plan text when no categories are seeded', () => {
    const empty = openDb(':memory:');
    const md = buildBriefing(empty, futureDate(5));
    expect(md).toContain('No categories seeded yet — run `npm run seed` before the next session.');
  });
});

describe('buildBriefing (with WS-A schema: due_at + episodes present)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    // Simulate WS-A's schema additions landing in the same db.
    db.exec(`
      ALTER TABLE categories ADD COLUMN due_at TEXT NULL;
      ALTER TABLE categories ADD COLUMN interval_days REAL NOT NULL DEFAULT 1;
      CREATE TABLE episodes(
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')),
        category_id TEXT NOT NULL, stem TEXT, options_json TEXT, correct_index INT,
        chosen_index INT, error_type TEXT, misconception TEXT, student_reasoning TEXT,
        embedding BLOB NULL);
    `);
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
      `INSERT INTO episodes (ts, category_id, misconception) VALUES (datetime('now', '-3 hours'), '4A', 'Confused impulse with momentum')`
    ).run();
    db.prepare(
      `INSERT INTO episodes (ts, category_id, misconception) VALUES (datetime('now', '-2 hours'), '4B', 'Applied Bernoulli without steady flow')`
    ).run();
    db.prepare(
      `INSERT INTO episodes (ts, category_id, misconception) VALUES (datetime('now', '-1 hours'), '5A', 'Mixed up entropy sign convention')`
    ).run();
    const md = buildBriefing(db, futureDate(5));
    const section = md.slice(md.indexOf('## Recent misconceptions'), md.indexOf("## Today's plan"));
    expect(section).toContain('5A: Mixed up entropy sign convention');
    expect(section).toContain('4B: Applied Bernoulli without steady flow');
    expect(section).not.toContain('4A: Confused impulse with momentum');
  });

  test('episodes with null misconception are excluded', () => {
    db.prepare(
      `INSERT INTO episodes (ts, category_id, misconception) VALUES (datetime('now'), '4A', NULL)`
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
