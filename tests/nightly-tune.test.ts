import { beforeEach, describe, expect, test } from 'vitest';
import type Database from 'better-sqlite3';
import { openDb } from '../lib/db';
import { seedTaxonomy, type Taxonomy } from '../lib/student';
import { buildTuningPrompt, gatherTuningData, type TuningData } from '../scripts/nightly-tune';

const tax: Taxonomy = {
  sections: [
    {
      id: 'chem_phys',
      name: 'CP',
      categories: [
        { id: '4A', name: 'Motion', topics: ['Kinematics'] },
        { id: '4B', name: 'Fluids', topics: ['Bernoulli'] },
      ],
    },
  ],
};

describe('buildTuningPrompt (pure function, no network)', () => {
  test('includes per-category accuracy computed from results', () => {
    const data: TuningData = {
      date: '2026-08-10',
      results: [
        { categoryId: '4A', difficulty: 2, correct: true, errorType: null, mode: 'drill' },
        { categoryId: '4A', difficulty: 2, correct: false, errorType: 'content', mode: 'drill' },
        { categoryId: '4A', difficulty: 2, correct: true, errorType: null, mode: 'drill' },
        { categoryId: '4A', difficulty: 2, correct: true, errorType: null, mode: 'drill' },
      ],
      episodes: null,
    };
    const prompt = buildTuningPrompt(data);
    expect(prompt).toContain('- 4A: 4 attempts, 75% accuracy');
  });

  test('includes error type breakdown', () => {
    const data: TuningData = {
      date: '2026-08-10',
      results: [
        { categoryId: '4A', difficulty: 1, correct: false, errorType: 'content', mode: 'drill' },
        { categoryId: '4A', difficulty: 1, correct: false, errorType: 'content', mode: 'drill' },
        { categoryId: '4B', difficulty: 1, correct: false, errorType: 'reasoning', mode: 'drill' },
      ],
      episodes: null,
    };
    const prompt = buildTuningPrompt(data);
    expect(prompt).toContain('- content: 2');
    expect(prompt).toContain('- reasoning: 1');
  });

  test('notes episodic memory is unavailable when episodes is null (WS-A not merged)', () => {
    const data: TuningData = { date: '2026-08-10', results: [], episodes: null };
    const prompt = buildTuningPrompt(data);
    expect(prompt).toContain('(episodic memory not available yet — WS-A not merged)');
  });

  test('lists misconceptions from episodes when present', () => {
    const data: TuningData = {
      date: '2026-08-10',
      results: [],
      episodes: [
        { categoryId: '4A', errorType: 'reasoning', misconception: 'Confused impulse with momentum' },
        { categoryId: '4B', errorType: null, misconception: null },
      ],
    };
    const prompt = buildTuningPrompt(data);
    expect(prompt).toContain('- 4A (reasoning): Confused impulse with momentum');
    expect(prompt).not.toContain('4B (');
  });

  test('handles zero attempts without dividing by zero', () => {
    const data: TuningData = { date: '2026-08-10', results: [], episodes: null };
    const prompt = buildTuningPrompt(data);
    expect(prompt).toContain('(no results recorded today)');
    expect(prompt).toContain('(no error types recorded today)');
    expect(prompt).toContain('Total attempts today: 0');
  });

  test('instructs the model never to rewrite instructions itself', () => {
    const data: TuningData = { date: '2026-08-10', results: [], episodes: null };
    const prompt = buildTuningPrompt(data);
    expect(prompt).toMatch(/Do NOT rewrite the instructions yourself/);
  });
});

describe('gatherTuningData (db read, no network)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    seedTaxonomy(db, tax);
  });

  test('returns null episodes when the episodes table does not exist', () => {
    const data = gatherTuningData(db);
    expect(data.episodes).toBeNull();
  });

  test("collects today's results only, excluding older rows", () => {
    db.prepare(
      `INSERT INTO results (ts, category_id, difficulty, correct, mode) VALUES (datetime('now'), '4A', 1, 1, 'drill')`
    ).run();
    db.prepare(
      `INSERT INTO results (ts, category_id, difficulty, correct, mode) VALUES (datetime('now', '-2 days'), '4B', 1, 0, 'drill')`
    ).run();
    const data = gatherTuningData(db);
    expect(data.results).toHaveLength(1);
    expect(data.results[0]).toMatchObject({ categoryId: '4A', correct: true });
  });

  test('collects episodes when the table exists, scoped to today', () => {
    db.exec(`
      CREATE TABLE episodes(
        id INTEGER PRIMARY KEY AUTOINCREMENT, ts TEXT DEFAULT (datetime('now')),
        category_id TEXT NOT NULL, stem TEXT, options_json TEXT, correct_index INT,
        chosen_index INT, error_type TEXT, misconception TEXT, student_reasoning TEXT,
        embedding BLOB NULL);
    `);
    db.prepare(
      `INSERT INTO episodes (ts, category_id, misconception) VALUES (datetime('now'), '4A', 'todays')`
    ).run();
    db.prepare(
      `INSERT INTO episodes (ts, category_id, misconception) VALUES (datetime('now', '-2 days'), '4B', 'old')`
    ).run();
    const data = gatherTuningData(db);
    expect(data.episodes).toHaveLength(1);
    expect(data.episodes![0]).toMatchObject({ categoryId: '4A', misconception: 'todays' });
  });
});
