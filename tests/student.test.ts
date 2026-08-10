import { afterEach, beforeEach, describe, expect, test, vi } from 'vitest';
import { openDb } from '../lib/db';
import {
  seedTaxonomy,
  seedSectionScores,
  getProfile,
  getDueCategories,
  recordEpisode,
  recordResult,
  writeSessionSummary,
  type Taxonomy,
} from '../lib/student';
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

describe('student model', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  test('seed then getProfile returns all categories with seeded mastery', () => {
    seedTaxonomy(db, tax);
    seedSectionScores(db, { chem_phys: 129 });
    const profile = getProfile(db);
    expect(profile.categories).toHaveLength(3);
    const expectedMastery = (129 - 118) / 14;
    for (const c of profile.categories) {
      expect(c.mastery).toBeCloseTo(expectedMastery);
      expect(c.attempts).toBe(0);
      expect(c.section).toBe('chem_phys');
      expect(c.errorTypes).toEqual({});
    }
  });

  test('recordResult moves mastery up on correct hard and increments attempts', () => {
    seedTaxonomy(db, tax);
    seedSectionScores(db, { chem_phys: 129 });
    const before = getProfile(db).categories.find((c) => c.id === '4A')!;
    expect(before.mastery).toBeCloseTo(11 / 14); // (129 - 118) / 14
    recordResult(db, { categoryId: '4A', difficulty: 3, correct: true, mode: 'drill' });
    const after = getProfile(db).categories.find((c) => c.id === '4A')!;
    // 0.75*(11/14) + 0.25*(0.5 + 3/6) = 47/56
    expect(after.mastery).toBeCloseTo(47 / 56);
    expect(after.attempts).toBe(1);
  });

  test('recordResult moves mastery down on wrong easy', () => {
    seedTaxonomy(db, tax);
    seedSectionScores(db, { chem_phys: 129 });
    const before = getProfile(db).categories.find((c) => c.id === '4A')!;
    expect(before.mastery).toBeCloseTo(11 / 14); // (129 - 118) / 14
    recordResult(db, { categoryId: '4A', difficulty: 1, correct: false, mode: 'drill' });
    const after = getProfile(db).categories.find((c) => c.id === '4A')!;
    // 0.75*(11/14) + 0.25*((1 - 1/6)*0.3) = 73/112
    expect(after.mastery).toBeCloseTo(73 / 112);
    expect(after.attempts).toBe(1);
  });

  test('mastery never drops below the 0.02 clamp floor, even from an extreme low seed plus repeated wrong answers', () => {
    seedTaxonomy(db, tax);
    // Far below the valid 118-132 range: raw (50 - 118) / 14 ≈ -4.86, must clamp to 0.02.
    seedSectionScores(db, { chem_phys: 50 });
    let mastery = getProfile(db).categories.find((c) => c.id === '4A')!.mastery;
    expect(mastery).toBeCloseTo(0.02);
    for (let i = 0; i < 20; i++) {
      recordResult(db, { categoryId: '4A', difficulty: 3, correct: false, mode: 'drill' });
      mastery = getProfile(db).categories.find((c) => c.id === '4A')!.mastery;
      expect(mastery).toBeGreaterThanOrEqual(0.02);
    }
  });

  test('mastery never exceeds the 0.98 clamp ceiling, even from an extreme high seed plus repeated correct answers', () => {
    seedTaxonomy(db, tax);
    // Far above the valid 118-132 range: raw (200 - 118) / 14 ≈ 5.86, must clamp to 0.98.
    seedSectionScores(db, { chem_phys: 200 });
    let mastery = getProfile(db).categories.find((c) => c.id === '4A')!.mastery;
    expect(mastery).toBeCloseTo(0.98);
    for (let i = 0; i < 20; i++) {
      recordResult(db, { categoryId: '4A', difficulty: 3, correct: true, mode: 'drill' });
      mastery = getProfile(db).categories.find((c) => c.id === '4A')!.mastery;
      expect(mastery).toBeLessThanOrEqual(0.98);
    }
  });

  test('recordResult aggregates errorTypes per category', () => {
    seedTaxonomy(db, tax);
    seedSectionScores(db, { chem_phys: 129 });
    recordResult(db, { categoryId: '4A', difficulty: 1, correct: false, errorType: 'content', mode: 'drill' });
    recordResult(db, { categoryId: '4A', difficulty: 1, correct: false, errorType: 'content', mode: 'drill' });
    recordResult(db, { categoryId: '4A', difficulty: 1, correct: false, errorType: 'reasoning', mode: 'drill' });
    const profile = getProfile(db);
    const cat = profile.categories.find((c) => c.id === '4A')!;
    expect(cat.errorTypes).toEqual({ content: 2, reasoning: 1 });
  });

  test('weakest orders by mastery with attempts-aware tiebreak (fewer attempts first)', () => {
    seedTaxonomy(db, tax);
    seedSectionScores(db, { chem_phys: 129 }); // 4A stays at seeded mastery (11/14), highest of the three
    // Force 4B and 5A to IDENTICAL mastery but different attempt counts, so the only way
    // to order them is the attempts tiebreak (fewer attempts first).
    db.prepare(`UPDATE categories SET mastery = 0.3, attempts = 5 WHERE id = '4B'`).run();
    db.prepare(`UPDATE categories SET mastery = 0.3, attempts = 1 WHERE id = '5A'`).run();
    const profile = getProfile(db);
    const b4 = profile.categories.find((c) => c.id === '4B')!;
    const a5 = profile.categories.find((c) => c.id === '5A')!;
    expect(b4.mastery).toBe(a5.mastery); // equal mastery is the premise of this test
    expect(profile.weakest[0]).toBe('5A'); // fewer attempts (1) wins the tie over 4B (5)
    expect(profile.weakest[1]).toBe('4B');
    expect(profile.weakest[2]).toBe('4A'); // untouched, higher mastery from seed
    expect(profile.weakest).toHaveLength(3);
  });

  test('writeSessionSummary then getProfile().lastSession round-trips', () => {
    seedTaxonomy(db, tax);
    writeSessionSummary(db, { mode: 'drill', summary: 'Covered kinematics', focusNext: 'Fluids next' });
    const profile = getProfile(db);
    expect(profile.lastSession).toEqual({
      mode: 'drill',
      summary: 'Covered kinematics',
      focusNext: 'Fluids next',
    });
  });

  test('getProfile().lastSession is null when no sessions recorded', () => {
    seedTaxonomy(db, tax);
    const profile = getProfile(db);
    expect(profile.lastSession).toBeNull();
  });

  test('recordResult with unknown categoryId throws', () => {
    seedTaxonomy(db, tax);
    expect(() =>
      recordResult(db, { categoryId: 'nope', difficulty: 1, correct: true, mode: 'drill' })
    ).toThrow();
  });

  test('recordResult doubles a correct category interval and schedules its next due date', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'));
    seedTaxonomy(db, tax);

    recordResult(db, { categoryId: '4A', difficulty: 2, correct: true, mode: 'drill' });

    expect(
      db.prepare('SELECT interval_days as intervalDays, due_at as dueAt FROM categories WHERE id = ?').get('4A')
    ).toEqual({ intervalDays: 2, dueAt: '2026-08-12T12:00:00.000Z' });
  });

  test('recordResult resets a wrong category interval to one day', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'));
    seedTaxonomy(db, tax);
    db.prepare('UPDATE categories SET interval_days = 8 WHERE id = ?').run('4A');

    recordResult(db, { categoryId: '4A', difficulty: 2, correct: false, mode: 'drill' });

    expect(
      db.prepare('SELECT interval_days as intervalDays, due_at as dueAt FROM categories WHERE id = ?').get('4A')
    ).toEqual({ intervalDays: 1, dueAt: '2026-08-11T12:00:00.000Z' });
  });

  test('recordResult caps a correct category interval at eight days', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'));
    seedTaxonomy(db, tax);
    db.prepare('UPDATE categories SET interval_days = 8 WHERE id = ?').run('4A');

    recordResult(db, { categoryId: '4A', difficulty: 3, correct: true, mode: 'drill' });

    expect(
      db.prepare('SELECT interval_days as intervalDays, due_at as dueAt FROM categories WHERE id = ?').get('4A')
    ).toEqual({ intervalDays: 8, dueAt: '2026-08-18T12:00:00.000Z' });
  });

  test('getDueCategories excludes future reviews and orders due categories by lowest mastery', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'));
    seedTaxonomy(db, tax);
    db.prepare("UPDATE categories SET mastery = 0.4, due_at = NULL WHERE id = '4A'").run();
    db.prepare("UPDATE categories SET mastery = 0.2, due_at = '2026-08-09T12:00:00.000Z' WHERE id = '4B'").run();
    db.prepare("UPDATE categories SET mastery = 0.1, due_at = '2026-08-11T12:00:00.000Z' WHERE id = '5A'").run();

    expect(getDueCategories(db)).toEqual(['4B', '4A']);
    expect(getDueCategories(db, 1)).toEqual(['4B']);
  });

  test('recordEpisode stores every supplied field including a precomputed embedding', () => {
    seedTaxonomy(db, tax);
    const embedding = new Float32Array([0.25, 0.75]);

    recordEpisode(db, {
      categoryId: '4A',
      stem: 'Which graph has constant acceleration?',
      options: ['A', 'B', 'C', 'D'],
      correctIndex: 2,
      chosenIndex: 1,
      errorType: 'reasoning',
      misconception: 'Velocity and acceleration were conflated',
      studentReasoning: 'A straight line meant no acceleration',
      embedding,
    });

    const row = db.prepare(
      `SELECT category_id as categoryId, stem, options_json as optionsJson,
              correct_index as correctIndex, chosen_index as chosenIndex,
              error_type as errorType, misconception,
              student_reasoning as studentReasoning, embedding
       FROM episodes`
    ).get() as Record<string, unknown>;
    expect({ ...row, embedding: Array.from(new Float32Array((row.embedding as Buffer).buffer, (row.embedding as Buffer).byteOffset, 2)) }).toEqual({
      categoryId: '4A',
      stem: 'Which graph has constant acceleration?',
      optionsJson: '["A","B","C","D"]',
      correctIndex: 2,
      chosenIndex: 1,
      errorType: 'reasoning',
      misconception: 'Velocity and acceleration were conflated',
      studentReasoning: 'A straight line meant no acceleration',
      embedding: [0.25, 0.75],
    });
  });

  test('getProfile includes due IDs and only the ten most recent non-null misconceptions', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-08-10T12:00:00.000Z'));
    seedTaxonomy(db, tax);
    db.prepare("UPDATE categories SET mastery = 0.2, due_at = NULL WHERE id = '4B'").run();
    db.prepare("UPDATE categories SET mastery = 0.4, due_at = NULL WHERE id = '4A'").run();
    db.prepare("UPDATE categories SET mastery = 0.1, due_at = '2026-08-11T12:00:00.000Z' WHERE id = '5A'").run();
    const insert = db.prepare(
      `INSERT INTO episodes
       (ts, category_id, stem, options_json, correct_index, chosen_index, misconception)
       VALUES (?, ?, ?, '[]', 0, 1, ?)`
    );
    for (let day = 1; day <= 11; day++) {
      insert.run(`2026-07-${String(day).padStart(2, '0')}T12:00:00.000Z`, '4A', `Stem ${day}`, `Misconception ${day}`);
    }
    insert.run('2026-08-01T12:00:00.000Z', '4B', 'No misconception', null);

    const profile = getProfile(db);

    expect(profile.due).toEqual(['4B', '4A']);
    expect(profile.recentMisconceptions).toHaveLength(10);
    expect(profile.recentMisconceptions[0]).toEqual({
      categoryId: '4A',
      misconception: 'Misconception 11',
      ts: '2026-07-11T12:00:00.000Z',
    });
    expect(profile.recentMisconceptions.at(-1)?.misconception).toBe('Misconception 2');
  });
});
