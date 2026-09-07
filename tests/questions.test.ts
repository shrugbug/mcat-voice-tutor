import { afterEach, describe, expect, test, vi } from 'vitest';
import { QuestionSchema, buildQuestionPrompt, generateQuestion, type QuestionParams } from '../lib/questions';

function validQuestion(overrides: Record<string, unknown> = {}) {
  return {
    passage: null,
    stem: 'Which change best accounts for the shift in the titration midpoint?',
    options: [
      'The buffer capacity fell because the conjugate base was consumed.',
      'The ionic strength rose, lowering the activity coefficient of the acid.',
      'The autoionization of water dominated once the acid was exhausted.',
      'The acid dissociation constant increased with dilution.',
    ],
    correctIndex: 1,
    distractorRationales: [
      'Buffer-capacity confusion: treats midpoint position as a capacity effect.',
      'Correct: activity, not concentration, sets the measured pH here.',
      'Water-autoionization overreach: invokes Kw far from the equivalence point.',
      'Ka-is-dilution-dependent misconception: Ka is a constant at fixed temperature.',
    ],
    difficulty: 3,
    categoryId: '5A',
    explanation: 'Activity coefficients drop as ionic strength rises, so measured pH shifts.',
    ...overrides,
  };
}

const baseParams: QuestionParams = {
  categoryId: '5A',
  categoryName: 'Unique nature of water and its solutions',
  topics: ['Acid-Base Equilibria', 'Ions in Solutions'],
  difficulty: 3,
  style: 'passage',
};

describe('QuestionSchema', () => {
  test('accepts a well-formed four-option question', () => {
    expect(QuestionSchema.parse(validQuestion())).toMatchObject({ correctIndex: 1 });
  });

  test('rejects a question with only three options', () => {
    const result = QuestionSchema.safeParse(
      validQuestion({
        options: ['first', 'second', 'third'],
        distractorRationales: ['a', 'b', 'c'],
      })
    );
    expect(result.success).toBe(false);
  });

  test('rejects correctIndex 4 because options are zero-indexed 0-3', () => {
    expect(QuestionSchema.safeParse(validQuestion({ correctIndex: 4 })).success).toBe(false);
  });

  test('rejects distractorRationales that are not index-aligned with the four options', () => {
    expect(
      QuestionSchema.safeParse(validQuestion({ distractorRationales: ['a', 'b', 'c'] })).success
    ).toBe(false);
  });

  test('rejects a difficulty outside 1-3', () => {
    expect(QuestionSchema.safeParse(validQuestion({ difficulty: 4 })).success).toBe(false);
  });

  test('accepts a passage string for passage-based questions', () => {
    const passage = 'Investigators titrated a novel diprotic acid in three ionic backgrounds.';
    expect(QuestionSchema.parse(validQuestion({ passage })).passage).toBe(passage);
  });
});

describe('buildQuestionPrompt', () => {
  test('includes the category name and its topics', () => {
    const prompt = buildQuestionPrompt(baseParams);
    expect(prompt).toContain('Unique nature of water and its solutions');
    expect(prompt).toContain('Acid-Base Equilibria');
    expect(prompt).toContain('Ions in Solutions');
  });

  test('calibrates difficulty 3 as beyond AAMC discrimination level', () => {
    const prompt = buildQuestionPrompt({ ...baseParams, difficulty: 3 });
    expect(prompt).toMatch(/harder than AAMC/i);
    expect(prompt).toMatch(/discriminat/i);
  });

  test('calibrates difficulty 1 as AAMC medium', () => {
    const prompt = buildQuestionPrompt({ ...baseParams, difficulty: 1 });
    expect(prompt).toMatch(/AAMC medium/i);
  });

  test('includes the grounding text when provided', () => {
    const groundingText = 'Water autoionizes with Kw = 1.0e-14 at 25 C.';
    const prompt = buildQuestionPrompt({ ...baseParams, groundingText });
    expect(prompt).toContain(groundingText);
    expect(prompt).toMatch(/source/i);
  });

  test('omits the source section when no grounding text is provided', () => {
    expect(buildQuestionPrompt(baseParams)).not.toMatch(/SOURCE MATERIAL/i);
  });

  test('asks for a 250-400 word passage in passage style', () => {
    const prompt = buildQuestionPrompt({ ...baseParams, style: 'passage' });
    expect(prompt).toContain('250');
    expect(prompt).toContain('400');
  });

  test('asks for no passage in discrete style', () => {
    expect(buildQuestionPrompt({ ...baseParams, style: 'discrete' })).toMatch(/no passage/i);
  });

  test('lists stems to avoid when provided', () => {
    const prompt = buildQuestionPrompt({
      ...baseParams,
      avoidStems: ['Which change best accounts for the shift in the titration midpoint?'],
    });
    expect(prompt).toContain('Which change best accounts for the shift in the titration midpoint?');
    expect(prompt).toMatch(/avoid/i);
  });

  test('requires specific misconception rationales and a correct-answer rationale', () => {
    const prompt = buildQuestionPrompt(baseParams);
    expect(prompt).toMatch(/SPECIFIC common misconception/);
    expect(prompt).toMatch(/correct.*rationale/i);
  });
});

describe('generateQuestion invariant enforcement', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.unstubAllEnvs();
  });

  const requestParams: QuestionParams = {
    categoryId: '5A',
    categoryName: 'Unique nature of water and its solutions',
    topics: ['Acid-Base Equilibria'],
    difficulty: 2,
    style: 'discrete',
  };

  function stubChatCompletion(question: Record<string, unknown>) {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('QUESTION_MODEL', 'gpt-5.1');
    return vi.fn(async (...request: Parameters<typeof fetch>) => {
      void request;
      return {
        ok: true,
        json: async () => ({ choices: [{ message: { content: JSON.stringify(question) } }] }),
      };
    });
  }

  test('accepts a response whose categoryId/difficulty/style match the request', async () => {
    const question = validQuestion({ categoryId: '5A', difficulty: 2, passage: null });
    const fetchMock = stubChatCompletion(question);
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateQuestion(requestParams)).resolves.toMatchObject({ categoryId: '5A', difficulty: 2 });
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const requestBody = JSON.parse(fetchMock.mock.calls[0][1]?.body as string) as Record<string, unknown>;
    expect(requestBody.max_completion_tokens).toBe(4096);
  });

  test('does not include a provider error body in the thrown diagnostic', async () => {
    const sentinel = 'PRIVATE_SOURCE_TEXT_42';
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 400, text: async () => sentinel }))
    );

    let message = '';
    try {
      await generateQuestion(requestParams);
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }
    expect(message).toContain('400');
    expect(message).not.toContain(sentinel);
  });

  test('retries once and throws when categoryId does not match the request', async () => {
    const question = validQuestion({ categoryId: '4A', difficulty: 2, passage: null });
    const fetchMock = stubChatCompletion(question);
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateQuestion(requestParams)).rejects.toThrow(/categoryId mismatch/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('retries once and throws when difficulty does not match the request', async () => {
    const question = validQuestion({ categoryId: '5A', difficulty: 3, passage: null });
    const fetchMock = stubChatCompletion(question);
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateQuestion(requestParams)).rejects.toThrow(/difficulty mismatch/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('retries once and throws when a discrete-style request gets a non-null passage', async () => {
    const question = validQuestion({ categoryId: '5A', difficulty: 2, passage: 'Unexpected passage text.' });
    const fetchMock = stubChatCompletion(question);
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateQuestion(requestParams)).rejects.toThrow(/style mismatch/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('retries once and throws when a passage-style request gets a null passage', async () => {
    const question = validQuestion({ categoryId: '5A', difficulty: 2, passage: null });
    const fetchMock = stubChatCompletion(question);
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateQuestion({ ...requestParams, style: 'passage' })).rejects.toThrow(/style mismatch/);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  test('recovers on the second attempt if the first violates an invariant', async () => {
    vi.stubEnv('OPENAI_API_KEY', 'test-key');
    vi.stubEnv('QUESTION_MODEL', 'gpt-5.1');
    let call = 0;
    const fetchMock = vi.fn(async () => {
      call += 1;
      const question = validQuestion({ categoryId: call === 1 ? '4A' : '5A', difficulty: 2, passage: null });
      return { ok: true, json: async () => ({ choices: [{ message: { content: JSON.stringify(question) } }] }) };
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(generateQuestion(requestParams)).resolves.toMatchObject({ categoryId: '5A' });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
