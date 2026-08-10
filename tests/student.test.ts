import { beforeEach, describe, expect, test } from 'vitest';
import { openDb } from '../lib/db';
import {
  seedTaxonomy,
  seedSectionScores,
  getProfile,
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
    recordResult(db, { categoryId: '4A', difficulty: 3, correct: true, mode: 'drill' });
    const after = getProfile(db).categories.find((c) => c.id === '4A')!;
    expect(after.mastery).toBeGreaterThan(before.mastery);
    expect(after.attempts).toBe(1);
  });

  test('recordResult moves mastery down on wrong easy', () => {
    seedTaxonomy(db, tax);
    seedSectionScores(db, { chem_phys: 129 });
    const before = getProfile(db).categories.find((c) => c.id === '4A')!;
    recordResult(db, { categoryId: '4A', difficulty: 1, correct: false, mode: 'drill' });
    const after = getProfile(db).categories.find((c) => c.id === '4A')!;
    expect(after.mastery).toBeLessThan(before.mastery);
    expect(after.attempts).toBe(1);
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
    seedSectionScores(db, { chem_phys: 122 }); // all three start with same mastery
    // Push 4B and 5A down further so ordering is deterministic on mastery alone.
    recordResult(db, { categoryId: '4B', difficulty: 1, correct: false, mode: 'drill' });
    recordResult(db, { categoryId: '5A', difficulty: 1, correct: false, mode: 'drill' });
    recordResult(db, { categoryId: '5A', difficulty: 1, correct: false, mode: 'drill' });
    const profile = getProfile(db);
    expect(profile.weakest[0]).toBe('5A');
    expect(profile.weakest[1]).toBe('4B');
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
});
