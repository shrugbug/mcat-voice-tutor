import { afterEach, describe, expect, test } from 'vitest';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadTaxonomy } from '../lib/taxonomy';

const tempDirectories: string[] = [];

function writeTaxonomyFile(contents: unknown): string {
  const directory = mkdtempSync(join(tmpdir(), 'mcat-taxonomy-'));
  const path = join(directory, 'taxonomy.json');
  tempDirectories.push(directory);
  writeFileSync(path, JSON.stringify(contents));
  return path;
}

afterEach(() => {
  for (const directory of tempDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe('loadTaxonomy', () => {
  test('flattens foundational-concept and direct section categories', () => {
    const path = writeTaxonomyFile({
      meta: {
        source: 'Test source',
        source_urls: ['https://example.com/taxonomy'],
        verified: '2026-08-09',
      },
      sections: [
        {
          id: 'chem_phys',
          name: 'Chemical and Physical Foundations',
          foundational_concepts: [
            {
              id: '4',
              name: 'Physical principles',
              categories: [
                { id: '4A', name: 'Motion', topics: ['Translational Motion'] },
                { id: '4B', name: 'Fluids', topics: ['Fluid dynamics'] },
              ],
            },
          ],
        },
        {
          id: 'cars',
          name: 'Critical Analysis and Reasoning Skills',
          categories: [
            { id: 'cars_comprehension', name: 'Foundations of Comprehension' },
          ],
        },
      ],
      sirs: [{ id: 'SIRS1', name: 'Knowledge of Scientific Concepts and Principles' }],
    });

    expect(loadTaxonomy(path)).toEqual({
      sections: [
        {
          id: 'chem_phys',
          name: 'Chemical and Physical Foundations',
          categories: [
            { id: '4A', name: 'Motion', topics: ['Translational Motion'] },
            { id: '4B', name: 'Fluids', topics: ['Fluid dynamics'] },
          ],
        },
        {
          id: 'cars',
          name: 'Critical Analysis and Reasoning Skills',
          categories: [
            { id: 'cars_comprehension', name: 'Foundations of Comprehension', topics: [] },
          ],
        },
      ],
    });
  });

  test('rejects a non-string topic with an error naming the bad field', () => {
    const path = writeTaxonomyFile({
      meta: {
        source: 'Test source',
        source_urls: ['https://example.com/taxonomy'],
        verified: '2026-08-09',
      },
      sections: [
        {
          id: 'chem_phys',
          name: 'Chemical and Physical Foundations',
          foundational_concepts: [
            {
              id: '4',
              name: 'Physical principles',
              categories: [{ id: '4A', name: 'Motion', topics: [42] }],
            },
          ],
        },
        {
          id: 'cars',
          name: 'Critical Analysis and Reasoning Skills',
          categories: [
            { id: 'cars_comprehension', name: 'Foundations of Comprehension' },
          ],
        },
      ],
      sirs: [{ id: 'SIRS1', name: 'Knowledge of Scientific Concepts and Principles' }],
    });

    expect(() => loadTaxonomy(path)).toThrow(/topics/);
  });
});
