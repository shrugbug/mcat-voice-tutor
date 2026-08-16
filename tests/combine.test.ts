import { describe, expect, test } from 'vitest';
import { openDb } from '../lib/db';
import { combineInto, COMBINED_TABLES } from '../lib/combine';

function seedSource(mastery: number, note: string) {
  const db = openDb(':memory:');
  db.prepare("INSERT INTO categories (id, section, name, mastery) VALUES ('4A','chem_phys','Motion',?)").run(mastery);
  db.prepare("INSERT INTO results (category_id, difficulty, correct, mode, note) VALUES ('4A',1,1,'drill',?)").run(note);
  db.prepare("INSERT INTO transcripts (role, text) VALUES ('user', ?)").run(note);
  return db;
}

describe('combineInto', () => {
  test('tags every row with its source and preserves the original id', () => {
    const target = openDb(':memory:');
    const prod = seedSource(0.7, 'from-prod');
    const demo = seedSource(0.2, 'from-demo');

    combineInto(target, [
      { source: 'prod', db: prod },
      { source: 'demo', db: demo },
    ]);

    const rows = target.prepare('SELECT source, orig_id, note FROM results ORDER BY source').all();
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({ source: 'demo', orig_id: 1, note: 'from-demo' });
    expect(rows[1]).toMatchObject({ source: 'prod', orig_id: 1, note: 'from-prod' });

    for (const db of [target, prod, demo]) db.close();
  });

  test('reassigns ids so colliding source ids do not merge', () => {
    const target = openDb(':memory:');
    const prod = seedSource(0.7, 'p');
    const demo = seedSource(0.2, 'd');
    combineInto(target, [{ source: 'prod', db: prod }, { source: 'demo', db: demo }]);

    const ids = target.prepare('SELECT id FROM results').all().map((r) => (r as { id: number }).id);
    expect(new Set(ids).size).toBe(2); // both sources had orig_id 1
    for (const db of [target, prod, demo]) db.close();
  });

  test('takes categories from prod only — demo mastery describes nobody', () => {
    const target = openDb(':memory:');
    const prod = seedSource(0.7, 'p');
    const demo = seedSource(0.2, 'd');
    combineInto(target, [{ source: 'prod', db: prod }, { source: 'demo', db: demo }]);

    const cats = target.prepare('SELECT id, mastery FROM categories').all();
    expect(cats).toHaveLength(1);
    expect((cats[0] as { mastery: number }).mastery).toBeCloseTo(0.7);
    for (const db of [target, prod, demo]) db.close();
  });

  test('takes categories from prod when demo is passed first', () => {
    const target = openDb(':memory:');
    const prod = seedSource(0.7, 'p');
    const demo = seedSource(0.2, 'd');
    combineInto(target, [{ source: 'demo', db: demo }, { source: 'prod', db: prod }]);

    const cats = target.prepare('SELECT id, mastery FROM categories').all();
    expect(cats).toHaveLength(1);
    expect((cats[0] as { mastery: number }).mastery).toBeCloseTo(0.7);
    for (const db of [target, prod, demo]) db.close();
  });

  test('rejects a combine with no prod source', () => {
    const target = openDb(':memory:');
    const demo = seedSource(0.2, 'd');

    expect(() => combineInto(target, [{ source: 'demo', db: demo }])).toThrow(/prod/i);
    for (const db of [target, demo]) db.close();
  });

  test('skips a table that does not exist in a source', () => {
    // tool_errors does not exist in the remote dbs until the app change is deployed there.
    // openDb() now creates it (it ships in lib/db.ts), so drop it to simulate an older source.
    const target = openDb(':memory:');
    const prod = seedSource(0.7, 'p');
    prod.exec('DROP TABLE IF EXISTS tool_errors');

    expect(() => combineInto(target, [{ source: 'prod', db: prod }])).not.toThrow();
    for (const db of [target, prod]) db.close();
  });

  test('COMBINED_TABLES covers every row-bearing table the tuner reads', () => {
    expect(COMBINED_TABLES).toEqual(['results', 'episodes', 'transcripts', 'feedback', 'sessions', 'tool_errors']);
  });
});
