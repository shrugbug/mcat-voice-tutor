import { beforeEach, describe, expect, test, vi } from 'vitest';
import { ZodError } from 'zod';
import type Database from 'better-sqlite3';
import { openDb } from '../lib/db';
import { recordEpisode, seedTaxonomy, type Taxonomy } from '../lib/student';
import { dispatchTool, recallSimilarMistakes, TOOL_DEFS } from '../lib/tools';

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

  test.each([
    {
      label: 'three answer options',
      args: {
        categoryId: '4A',
        stem: 'A stem',
        options: ['A', 'B', 'C'],
        correctIndex: 2,
        chosenIndex: 1,
      },
    },
    {
      label: 'an out-of-range answer index',
      args: {
        categoryId: '4A',
        stem: 'A stem',
        options: ['A', 'B', 'C', 'D'],
        correctIndex: 4,
        chosenIndex: 1,
      },
    },
  ])('record_episode rejects $label before attempting an embedding request', async ({ args }) => {
    await expect(dispatchTool(db, 'record_episode', args)).rejects.toBeInstanceOf(ZodError);
  });

  test('recall_similar_mistakes rejects a limit above five before attempting an embedding request', async () => {
    await expect(
      dispatchTool(db, 'recall_similar_mistakes', { query: 'kinematics', k: 6 })
    ).rejects.toBeInstanceOf(ZodError);
  });

  test.each([
    ['record_result note', 'record_result', { categoryId: '4A', difficulty: 1, correct: true, mode: 'drill', note: 'x'.repeat(2001) }],
    ['record_episode stem', 'record_episode', { categoryId: '4A', stem: 'x'.repeat(8001), options: ['A', 'B', 'C', 'D'], correctIndex: 0, chosenIndex: 1 }],
    ['recall query', 'recall_similar_mistakes', { query: 'x'.repeat(4001) }],
    ['material query', 'search_materials', { query: 'x'.repeat(4001) }],
    ['material result count', 'search_materials', { query: 'kinematics', k: 6 }],
    ['feedback paraphrase', 'record_feedback', { kind: 'ui', quote: 'short', paraphrase: 'x'.repeat(2001) }],
    ['session summary', 'end_session_summary', { mode: 'drill', summary: 'x'.repeat(8001), focusNext: 'kinematics' }],
  ])('rejects oversized or excessive %s input', async (_label, name, args) => {
    const fetchSpy = vi.spyOn(globalThis, 'fetch').mockRejectedValue(new Error('network should not be called'));
    try {
      await expect(dispatchTool(db, name, args)).rejects.toBeInstanceOf(ZodError);
      expect(fetchSpy).not.toHaveBeenCalled();
    } finally {
      fetchSpy.mockRestore();
    }
  });

  test('recallSimilarMistakes ranks stored episodes by cosine similarity and omits episodes without embeddings', () => {
    recordEpisode(db, {
      categoryId: '4A',
      stem: 'Velocity graph mistake',
      options: ['A', 'B', 'C', 'D'],
      correctIndex: 0,
      chosenIndex: 1,
      errorType: 'reasoning',
      misconception: 'Slope was treated as position',
      embedding: new Float32Array([1, 0]),
    });
    recordEpisode(db, {
      categoryId: '4B',
      stem: 'Fluid pressure mistake',
      options: ['A', 'B', 'C', 'D'],
      correctIndex: 2,
      chosenIndex: 3,
      errorType: 'content',
      misconception: 'Pressure was treated as velocity',
      embedding: new Float32Array([0, 1]),
    });
    recordEpisode(db, {
      categoryId: '5A',
      stem: 'Unembedded thermodynamics mistake',
      options: ['A', 'B', 'C', 'D'],
      correctIndex: 1,
      chosenIndex: 0,
      misconception: 'Entropy was reversed',
    });

    const results = recallSimilarMistakes(db, new Float32Array([0.9, 0.1]), 2);

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({
      stem: 'Velocity graph mistake',
      misconception: 'Slope was treated as position',
      errorType: 'reasoning',
      categoryId: '4A',
    });
    expect(results[1]).toMatchObject({
      stem: 'Fluid pressure mistake',
      misconception: 'Pressure was treated as velocity',
      errorType: 'content',
      categoryId: '4B',
    });
    expect(results[0]).toHaveProperty('ts');
  });

  test('TOOL_DEFS tells the model when to use both episodic-memory tools', () => {
    const recordDefinition = TOOL_DEFS.find(({ name }) => name === 'record_episode');
    const recallDefinition = TOOL_DEFS.find(({ name }) => name === 'recall_similar_mistakes');

    expect(recordDefinition?.description).toContain('after every missed question');
    expect(recordDefinition?.description).toContain('record_result');
    expect(recallDefinition?.description).toContain('when opening a topic');
  });

  test.each(['show_content', 'render_view'])('throws for client-side tool %s', async (name) => {
    await expect(dispatchTool(db, name, {})).rejects.toThrow(`Unknown tool: ${name}`);
  });

  test('record_feedback inserts a feedback row and returns ok', async () => {
    const result = await dispatchTool(db, 'record_feedback', {
      kind: 'ui',
      quote: 'the mastery chart is too small to read',
      paraphrase: 'Wants a bigger mastery chart',
    });

    expect(result).toEqual({ ok: true });
    expect(
      db.prepare('SELECT kind, quote, paraphrase, status FROM feedback').get()
    ).toEqual({
      kind: 'ui',
      quote: 'the mastery chart is too small to read',
      paraphrase: 'Wants a bigger mastery chart',
      status: 'new',
    });
  });

  test('record_feedback inserts with a null paraphrase when omitted', async () => {
    await dispatchTool(db, 'record_feedback', { kind: 'ux', quote: 'this flow confused me' });

    expect(db.prepare('SELECT paraphrase FROM feedback').get()).toEqual({ paraphrase: null });
  });

  test('record_feedback rejects an unknown kind', async () => {
    await expect(
      dispatchTool(db, 'record_feedback', { kind: 'bug', quote: 'not allowed' })
    ).rejects.toBeInstanceOf(ZodError);
  });

  test('record_feedback rejects a missing quote', async () => {
    await expect(dispatchTool(db, 'record_feedback', { kind: 'ui' })).rejects.toBeInstanceOf(ZodError);
  });

  test('record_feedback rejects a quote over 1000 characters', async () => {
    await expect(
      dispatchTool(db, 'record_feedback', { kind: 'ui', quote: 'x'.repeat(1001) })
    ).rejects.toBeInstanceOf(ZodError);
  });
});
