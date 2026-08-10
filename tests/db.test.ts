import { afterEach, describe, expect, test } from 'vitest';
import Database from 'better-sqlite3';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../lib/db';

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('WS-A database schema', () => {
  test('fresh databases round-trip episode fields and spaced-repetition category fields', () => {
    const db = openDb(':memory:');
    const embedding = Buffer.from(new Float32Array([0.25, 0.75]).buffer);

    db.prepare(
      `INSERT INTO categories
       (id, section, name, due_at, interval_days)
       VALUES (?, ?, ?, ?, ?)`
    ).run('4A', 'chem_phys', 'Motion', '2026-08-12T12:00:00.000Z', 4);
    db.prepare(
      `INSERT INTO episodes
       (category_id, stem, options_json, correct_index, chosen_index, error_type,
        misconception, student_reasoning, embedding)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      '4A',
      'A kinematics stem',
      JSON.stringify(['A', 'B', 'C', 'D']),
      2,
      1,
      'reasoning',
      'Confused velocity with acceleration',
      'The slope looked constant',
      embedding
    );

    expect(
      db.prepare('SELECT due_at as dueAt, interval_days as intervalDays FROM categories WHERE id = ?').get('4A')
    ).toEqual({ dueAt: '2026-08-12T12:00:00.000Z', intervalDays: 4 });
    expect(
      db.prepare(
        `SELECT category_id as categoryId, stem, options_json as optionsJson,
                correct_index as correctIndex, chosen_index as chosenIndex,
                error_type as errorType, misconception,
                student_reasoning as studentReasoning, embedding
         FROM episodes`
      ).get()
    ).toEqual({
      categoryId: '4A',
      stem: 'A kinematics stem',
      optionsJson: '["A","B","C","D"]',
      correctIndex: 2,
      chosenIndex: 1,
      errorType: 'reasoning',
      misconception: 'Confused velocity with acceleration',
      studentReasoning: 'The slope looked constant',
      embedding,
    });

    db.close();
  });

  test('opening an old-shaped database twice adds each category column exactly once and preserves data', () => {
    const directory = mkdtempSync(join(tmpdir(), 'mcat-wsa-db-'));
    temporaryDirectories.push(directory);
    const path = join(directory, 'old.db');
    const oldDb = new Database(path);
    oldDb.exec(`
      CREATE TABLE categories(
        id TEXT PRIMARY KEY, section TEXT NOT NULL, name TEXT NOT NULL,
        topics TEXT NOT NULL DEFAULT '[]',
        mastery REAL NOT NULL DEFAULT 0.5, attempts INTEGER NOT NULL DEFAULT 0
      );
      INSERT INTO categories (id, section, name) VALUES ('4A', 'chem_phys', 'Motion');
    `);
    oldDb.close();

    openDb(path).close();
    const migratedDb = openDb(path);
    const columns = migratedDb.pragma('table_info(categories)') as { name: string }[];

    expect(columns.filter(({ name }) => name === 'due_at')).toHaveLength(1);
    expect(columns.filter(({ name }) => name === 'interval_days')).toHaveLength(1);
    expect(
      migratedDb.prepare('SELECT id, due_at as dueAt, interval_days as intervalDays FROM categories').get()
    ).toEqual({ id: '4A', dueAt: null, intervalDays: 1 });
    expect(
      (migratedDb.pragma('table_info(episodes)') as { name: string }[]).map(({ name }) => name)
    ).toEqual([
      'id',
      'ts',
      'category_id',
      'stem',
      'options_json',
      'correct_index',
      'chosen_index',
      'error_type',
      'misconception',
      'student_reasoning',
      'embedding',
    ]);

    migratedDb.close();
  });
});
