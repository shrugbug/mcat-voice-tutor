import { beforeEach, describe, expect, test } from 'vitest';
import RawDatabase from 'better-sqlite3';
import type Database from 'better-sqlite3';
import { openDb } from '../lib/db';
import { seedTaxonomy, type Taxonomy } from '../lib/student';
import { buildTuningPrompt, gatherTuningData, type TuningData } from '../scripts/nightly-tune';

/**
 * openDb() now always creates the episodes table (WS-A merged into lib/db.ts). To genuinely
 * exercise gatherTuningData's tolerance branch for older db files that predate WS-A, build that
 * old schema directly instead of going through openDb(). Mirrors lib/db.ts's categories/results
 * shapes minus due_at/interval_days, no episodes.
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
      transcript: null,
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
      transcript: null,
    };
    const prompt = buildTuningPrompt(data);
    expect(prompt).toContain('- content: 2');
    expect(prompt).toContain('- reasoning: 1');
  });

  test('notes episodic memory is unavailable when episodes is null (WS-A not merged)', () => {
    const data: TuningData = { date: '2026-08-10', results: [], episodes: null, transcript: null };
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
      transcript: null,
    };
    const prompt = buildTuningPrompt(data);
    expect(prompt).toContain('- 4A (reasoning): Confused impulse with momentum');
    expect(prompt).not.toContain('4B (');
  });

  test('handles zero attempts without dividing by zero', () => {
    const data: TuningData = { date: '2026-08-10', results: [], episodes: null, transcript: null };
    const prompt = buildTuningPrompt(data);
    expect(prompt).toContain('(no results recorded today)');
    expect(prompt).toContain('(no error types recorded today)');
    expect(prompt).toContain('Total attempts today: 0');
  });

  test('instructs the model never to rewrite instructions itself', () => {
    const data: TuningData = { date: '2026-08-10', results: [], episodes: null, transcript: null };
    const prompt = buildTuningPrompt(data);
    expect(prompt).toMatch(/Do NOT rewrite the instructions yourself/);
  });

  test('includes a DIALOGUE section with role-prefixed lines when transcript has lines', () => {
    const data: TuningData = {
      date: '2026-08-10',
      results: [],
      episodes: null,
      transcript: [
        { role: 'user', text: 'What is impulse?' },
        { role: 'bot', text: 'Impulse is force times time. Can you define momentum?' },
      ],
    };
    const prompt = buildTuningPrompt(data);
    expect(prompt).toContain('DIALOGUE');
    expect(prompt).toContain('user: What is impulse?');
    expect(prompt).toContain('bot: Impulse is force times time. Can you define momentum?');
    expect(prompt).toMatch(/critique examiner behavior/i);
  });

  test('omits dialogue content cleanly when transcript is an empty array', () => {
    const data: TuningData = { date: '2026-08-10', results: [], episodes: null, transcript: [] };
    const prompt = buildTuningPrompt(data);
    expect(prompt).toContain('DIALOGUE');
    expect(prompt).toContain('(no transcript recorded today)');
  });

  test('notes transcript is unavailable when transcript is null (transcripts table not present)', () => {
    const data: TuningData = { date: '2026-08-10', results: [], episodes: null, transcript: null };
    const prompt = buildTuningPrompt(data);
    expect(prompt).toContain('(transcript not available yet — transcripts table not present)');
  });
});

describe('gatherTuningData (db read, no network)', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    seedTaxonomy(db, tax);
  });

  test('returns null episodes and null transcript when neither table exists', () => {
    const preWsA = openPreWsADb();
    seedTaxonomy(preWsA, tax);
    const data = gatherTuningData(preWsA);
    expect(data.episodes).toBeNull();
    expect(data.transcript).toBeNull();
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
    // openDb() already creates the episodes table (WS-A merged) — no manual CREATE TABLE needed.
    db.prepare(
      `INSERT INTO episodes (ts, category_id, stem, options_json, correct_index, chosen_index, misconception) VALUES (datetime('now'), '4A', 'stem', '[]', 0, 0, 'todays')`
    ).run();
    db.prepare(
      `INSERT INTO episodes (ts, category_id, stem, options_json, correct_index, chosen_index, misconception) VALUES (datetime('now', '-2 days'), '4B', 'stem', '[]', 0, 0, 'old')`
    ).run();
    const data = gatherTuningData(db);
    expect(data.episodes).toHaveLength(1);
    expect(data.episodes![0]).toMatchObject({ categoryId: '4A', misconception: 'todays' });
  });

  test('collects transcript lines when the table exists, scoped to today and ordered chronologically', () => {
    // openDb() already creates the transcripts table -- no manual CREATE TABLE needed.
    db.prepare(`INSERT INTO transcripts (ts, role, text) VALUES (datetime('now'), 'user', 'first today')`).run();
    db.prepare(`INSERT INTO transcripts (ts, role, text) VALUES (datetime('now'), 'bot', 'second today')`).run();
    db.prepare(
      `INSERT INTO transcripts (ts, role, text) VALUES (datetime('now', '-2 days'), 'user', 'old line')`
    ).run();

    const data = gatherTuningData(db);
    expect(data.transcript).toEqual([
      { role: 'user', text: 'first today' },
      { role: 'bot', text: 'second today' },
    ]);
  });

  test('caps transcript lines at the most recent 400, still in chronological order', () => {
    const insert = db.prepare(`INSERT INTO transcripts (ts, role, text) VALUES (datetime('now'), 'user', ?)`);
    for (let i = 0; i < 450; i++) insert.run(`line-${i}`);

    const data = gatherTuningData(db);
    expect(data.transcript).toHaveLength(400);
    expect(data.transcript![0].text).toBe('line-50');
    expect(data.transcript![399].text).toBe('line-449');
  });
});
