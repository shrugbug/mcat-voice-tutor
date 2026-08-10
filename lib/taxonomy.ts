import { readFileSync } from 'node:fs';
import { z } from 'zod';
import type { Taxonomy } from './student';

const categorySchema = z
  .object({
    id: z.string(),
    name: z.string(),
    topics: z.array(z.string()),
  })
  .strict();

const directCategorySchema = z
  .object({
    id: z.string(),
    name: z.string(),
  })
  .strict();

const foundationalConceptSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    categories: z.array(categorySchema),
  })
  .strict();

const foundationalSectionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    foundational_concepts: z.array(foundationalConceptSchema),
  })
  .strict();

const directSectionSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    categories: z.array(directCategorySchema),
  })
  .strict();

const taxonomyFileSchema = z
  .object({
    meta: z
      .object({
        source: z.string(),
        source_urls: z.array(z.string()),
        verified: z.string(),
      })
      .strict(),
    sections: z.array(z.union([foundationalSectionSchema, directSectionSchema])),
    sirs: z.array(
      z
        .object({
          id: z.string(),
          name: z.string(),
        })
        .strict()
    ),
  })
  .strict();

export function loadTaxonomy(path = 'data/taxonomy.json'): Taxonomy {
  const source = taxonomyFileSchema.parse(JSON.parse(readFileSync(path, 'utf8')));

  return {
    sections: source.sections.map((section) => ({
      id: section.id,
      name: section.name,
      categories:
        'foundational_concepts' in section
          ? section.foundational_concepts.flatMap((concept) => concept.categories)
          : section.categories.map((category) => ({ ...category, topics: [] })),
    })),
  };
}
