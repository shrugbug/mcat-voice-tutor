import { beforeEach, describe, expect, test } from 'vitest';
import { ZodError } from 'zod';
import type Database from 'better-sqlite3';
import { openDb } from '../lib/db';
import { seedTaxonomy, type Taxonomy } from '../lib/student';
import { dispatchTool } from '../lib/tools';

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

describe('dispatchTool', () => {
  let db: Database.Database;

  beforeEach(() => {
    db = openDb(':memory:');
    seedTaxonomy(db, tax);
  });

  test('get_student_profile returns the profile from the database', async () => {
    const result = await dispatchTool(db, 'get_student_profile', {});

    expect(result).toMatchObject({
      categories: [
        { id: '4A', name: 'Motion', attempts: 0 },
        { id: '4B', name: 'Fluids', attempts: 0 },
        { id: '5A', name: 'Thermo', attempts: 0 },
      ],
      lastSession: null,
      weakest: ['4A', '4B', '5A'],
    });
  });

  test('record_result throws a ZodError for invalid arguments', async () => {
    await expect(
      dispatchTool(db, 'record_result', {
        categoryId: '4A',
        difficulty: 4,
        correct: true,
        mode: 'drill',
      })
    ).rejects.toBeInstanceOf(ZodError);
  });

  test.each(['show_content', 'render_view'])('throws for client-side tool %s', async (name) => {
    await expect(dispatchTool(db, name, {})).rejects.toThrow(`Unknown tool: ${name}`);
  });
});
