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

  describe('data_table row cap', () => {
    const table = (rowCount: number) => ({
      component: 'data_table' as const,
      headers: ['Category', 'Mastery'],
      rows: Array.from({ length: rowCount }, (_, i) => [`cat-${i}`, '0.50']),
    });

    test('accepts a row per taxonomy category (34) — the curriculum overview case', () => {
      expect(ViewSpecSchema.safeParse(table(34)).success).toBe(true);
    });

    test('accepts up to 60 rows', () => {
      expect(ViewSpecSchema.safeParse(table(60)).success).toBe(true);
    });

    test('still rejects an unbounded table', () => {
      expect(ViewSpecSchema.safeParse(table(61)).success).toBe(false);
    });
  });

  test('rejects a data table with more than 60 rows', () => {
    const result = ViewSpecSchema.safeParse({
      component: 'data_table',
      headers: ['Header'],
      rows: Array.from({ length: 61 }, () => ['Cell']),
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

  // CHANGED 2026-08-11 after a live production failure. These two tests previously asserted
  // that an unknown property REJECTS the whole view. That strictness took the app down for a
  // real student: the model sent `questionId` on an answer_grid and nothing rendered at all.
  // Unknown keys are now stripped. The tradeoff is deliberate — a dropped field degrades one
  // detail, a rejected view shows the student nothing.
  test('strips unknown view properties instead of rejecting', () => {
    const result = ViewSpecSchema.safeParse({
      component: 'passage',
      html: '<p>Passage text</p>',
      unsafe: true,
    });

    expect(result.success).toBe(true);
    expect(result.success && 'unsafe' in result.data).toBe(false);
  });

  test('strips unknown nested properties instead of rejecting', () => {
    const result = ViewSpecSchema.safeParse({
      component: 'flashcard_deck',
      cards: [{ front: 'Front', back: 'Back', hint: 'Not supported' }],
    });

    expect(result.success).toBe(true);
    if (result.success && result.data.component === 'flashcard_deck') {
      expect('hint' in result.data.cards[0]).toBe(false);
    }
  });
});

/**
 * Regression: 2026-08-11 live production failure. The model passed `questionId` into
 * answer_grid; every view schema used z.strictObject, so ONE unrecognised property made the
 * whole render fail and the student saw no question at all. Unknown keys are now stripped.
 * Rejecting the render is strictly worse than ignoring a field the model invented.
 */
describe('unknown properties are stripped, not fatal', () => {
  test('answer_grid tolerates the questionId that broke production', () => {
    const parsed = ViewSpecSchema.safeParse({
      component: 'answer_grid',
      options: ['a', 'b', 'c', 'd'],
      revealed: false,
      questionId: 'q-123',
    });
    expect(parsed.success).toBe(true);
    expect(parsed.success && 'questionId' in parsed.data).toBe(false);
  });

  test.each([
    ['flashcard_deck', { component: 'flashcard_deck', cards: [{ front: 'a', back: 'b' }] }],
    ['timer', { component: 'timer', seconds: 60, running: true }],
    ['passage', { component: 'passage', html: '<p>x</p>' }],
    ['mastery_chart', { component: 'mastery_chart', categories: [{ id: '4A', name: 'x', mastery: 0.5 }] }],
    ['data_table', { component: 'data_table', headers: ['a'], rows: [['1']] }],
  ])('%s tolerates an unknown key', (_name, view) => {
    expect(ViewSpecSchema.safeParse({ ...view, madeUpField: 'x' }).success).toBe(true);
  });

  test('genuinely invalid views are still rejected', () => {
    expect(ViewSpecSchema.safeParse({ component: 'answer_grid', options: ['a'], revealed: false }).success).toBe(false);
    expect(ViewSpecSchema.safeParse({ component: 'nonexistent' }).success).toBe(false);
  });
});

describe('answer_grid stem', () => {
  test('accepts a stem and keeps it', () => {
    const r = ViewSpecSchema.safeParse({
      component: 'answer_grid',
      stem: 'A 0.50 kg frog jumps to 0.40 m. What is the average net force?',
      options: ['a', 'b', 'c', 'd'],
      revealed: false,
    });
    expect(r.success).toBe(true);
    expect(r.success && r.data.component === 'answer_grid' && r.data.stem).toContain('frog');
  });

  test('stem stays optional so older payloads still render', () => {
    expect(
      ViewSpecSchema.safeParse({ component: 'answer_grid', options: ['a', 'b', 'c', 'd'], revealed: false }).success
    ).toBe(true);
  });
});
