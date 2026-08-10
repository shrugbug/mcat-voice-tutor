import { describe, expect, test } from 'vitest';
import { ViewSpecSchema } from '../lib/views';

describe('ViewSpecSchema', () => {
  test.each([
    {
      component: 'flashcard_deck',
      cards: [{ front: 'What is the rate-limiting enzyme of glycolysis?', back: 'PFK-1' }],
      title: 'Metabolism review',
    },
    {
      component: 'answer_grid',
      options: ['Aldosterone', 'Cortisol', 'Insulin', 'Glucagon'],
      revealed: true,
      correctIndex: 2,
    },
    { component: 'timer', seconds: 95, label: 'Passage time', running: true },
    {
      component: 'mastery_chart',
      categories: [{ id: '4A', name: 'Translational motion', mastery: 0.72 }],
    },
    {
      component: 'data_table',
      headers: ['Hormone', 'Source'],
      rows: [['Insulin', 'Pancreatic beta cells']],
      title: 'Endocrine comparison',
    },
    { component: 'passage', html: '<p>Passage text</p>', title: 'Passage 1' },
  ])('accepts a valid $component view', (view) => {
    expect(ViewSpecSchema.safeParse(view).success).toBe(true);
  });

  test('rejects an answer grid with fewer than four options', () => {
    const result = ViewSpecSchema.safeParse({
      component: 'answer_grid',
      options: ['One', 'Two', 'Three'],
      revealed: false,
    });

    expect(result.success).toBe(false);
  });

  test('rejects an answer grid with more than four options', () => {
    const result = ViewSpecSchema.safeParse({
      component: 'answer_grid',
      options: ['One', 'Two', 'Three', 'Four', 'Five'],
      revealed: false,
    });

    expect(result.success).toBe(false);
  });

  test('rejects a revealed answer grid without a correct answer', () => {
    const result = ViewSpecSchema.safeParse({
      component: 'answer_grid',
      options: ['One', 'Two', 'Three', 'Four'],
      revealed: true,
    });

    expect(result.success).toBe(false);
  });

  test.each([0, 7201])('rejects timer seconds outside the allowed range: %s', (seconds) => {
    const result = ViewSpecSchema.safeParse({
      component: 'timer',
      seconds,
      running: true,
    });

    expect(result.success).toBe(false);
  });

  test('rejects a timer with fractional seconds', () => {
    const result = ViewSpecSchema.safeParse({
      component: 'timer',
      seconds: 1.5,
      running: true,
    });

    expect(result.success).toBe(false);
  });

  test.each([-0.01, 1.01])('rejects mastery outside zero through one: %s', (mastery) => {
    const result = ViewSpecSchema.safeParse({
      component: 'mastery_chart',
      categories: [{ id: '4A', name: 'Translational motion', mastery }],
    });

    expect(result.success).toBe(false);
  });

  test.each([0, 41])('rejects a mastery chart with %s categories', (count) => {
    const result = ViewSpecSchema.safeParse({
      component: 'mastery_chart',
      categories: Array.from({ length: count }, (_, index) => ({
        id: String(index),
        name: `Category ${index}`,
        mastery: 0.5,
      })),
    });

    expect(result.success).toBe(false);
  });

  test('rejects a data table with a ragged row', () => {
    const result = ViewSpecSchema.safeParse({
      component: 'data_table',
      headers: ['Hormone', 'Source'],
      rows: [['Insulin']],
    });

    expect(result.success).toBe(false);
  });

  test.each([0, 9])('rejects a data table with %s headers', (count) => {
    const result = ViewSpecSchema.safeParse({
      component: 'data_table',
      headers: Array.from({ length: count }, (_, index) => `Header ${index}`),
      rows: [],
    });

    expect(result.success).toBe(false);
  });

  test('rejects a data table with more than 30 rows', () => {
    const result = ViewSpecSchema.safeParse({
      component: 'data_table',
      headers: ['Header'],
      rows: Array.from({ length: 31 }, () => ['Cell']),
    });

    expect(result.success).toBe(false);
  });

  test('rejects an empty flashcard deck', () => {
    const result = ViewSpecSchema.safeParse({
      component: 'flashcard_deck',
      cards: [],
    });

    expect(result.success).toBe(false);
  });

  test('rejects a flashcard deck with more than 50 cards', () => {
    const result = ViewSpecSchema.safeParse({
      component: 'flashcard_deck',
      cards: Array.from({ length: 51 }, () => ({ front: 'Front', back: 'Back' })),
    });

    expect(result.success).toBe(false);
  });

  test('rejects an unknown component name', () => {
    const result = ViewSpecSchema.safeParse({ component: 'concept_map', nodes: [] });

    expect(result.success).toBe(false);
  });

  test('rejects unknown view properties', () => {
    const result = ViewSpecSchema.safeParse({
      component: 'passage',
      html: '<p>Passage text</p>',
      unsafe: true,
    });

    expect(result.success).toBe(false);
  });

  test('rejects unknown nested properties', () => {
    const result = ViewSpecSchema.safeParse({
      component: 'flashcard_deck',
      cards: [{ front: 'Front', back: 'Back', hint: 'Not supported' }],
    });

    expect(result.success).toBe(false);
  });
});
