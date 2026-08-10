import { z } from 'zod';
import type { DB } from './db';
import { embed } from './embeddings';
import { generateQuestion, QuestionSchema } from './questions';
import { searchMaterials } from './rag';
import { getProfile, recordResult, writeSessionSummary } from './student';

const recordResultArgsSchema = z.strictObject({
  categoryId: z.string(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  correct: z.boolean(),
  errorType: z.enum(['content', 'reasoning', 'misread']).optional(),
  mode: z.string(),
  note: z.string().optional(),
});

const generateQuestionArgsSchema = z.strictObject({
  categoryId: z.string(),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  style: z.enum(['discrete', 'passage']),
  useGrounding: z.boolean().optional(),
});

const searchMaterialsArgsSchema = z.strictObject({
  query: z.string(),
  k: z.number().int().positive().optional(),
});

const endSessionSummaryArgsSchema = z.strictObject({
  mode: z.string(),
  summary: z.string(),
  focusNext: z.string(),
});

const topicsSchema = z.array(z.string());

export const TOOL_DEFS = [
  {
    type: 'function',
    name: 'get_student_profile',
    description: 'Get the student profile, recent session, weakest categories, and mastery data.',
    parameters: {
      type: 'object',
      properties: {},
      required: [],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'record_result',
    description: 'Record the result of one answered MCAT question and update category mastery.',
    parameters: {
      type: 'object',
      properties: {
        categoryId: { type: 'string', description: 'The tested MCAT category ID.' },
        difficulty: { type: 'integer', enum: [1, 2, 3], description: 'Question difficulty.' },
        correct: { type: 'boolean', description: 'Whether the student answered correctly.' },
        errorType: {
          type: 'string',
          enum: ['content', 'reasoning', 'misread'],
          description: 'The diagnosed error type when the answer was incorrect.',
        },
        mode: { type: 'string', description: 'The active study mode.' },
        note: { type: 'string', description: 'Optional concise note about the result.' },
      },
      required: ['categoryId', 'difficulty', 'correct', 'mode'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'generate_question',
    description: 'Generate one calibrated MCAT question for a taxonomy category.',
    parameters: {
      type: 'object',
      properties: {
        categoryId: { type: 'string', description: 'The target MCAT category ID.' },
        difficulty: { type: 'integer', enum: [1, 2, 3], description: 'Question difficulty.' },
        style: {
          type: 'string',
          enum: ['discrete', 'passage'],
          description: 'Whether to generate a discrete or passage-based question.',
        },
        useGrounding: {
          type: 'boolean',
          description: 'Whether to ground the question in the indexed study materials.',
        },
      },
      required: ['categoryId', 'difficulty', 'style'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'search_materials',
    description: 'Search indexed MCAT study materials for semantically relevant chunks.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The material search query.' },
        k: { type: 'integer', minimum: 1, description: 'Optional maximum number of chunks.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'end_session_summary',
    description: 'Save the completed study session summary and next-focus recommendation.',
    parameters: {
      type: 'object',
      properties: {
        mode: { type: 'string', description: 'The study mode used.' },
        summary: { type: 'string', description: 'A concise summary of the session.' },
        focusNext: { type: 'string', description: 'What the student should focus on next.' },
      },
      required: ['mode', 'summary', 'focusNext'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'show_content',
    description: 'Display passage, question, diagram, or feedback content in the study interface.',
    parameters: {
      type: 'object',
      properties: {
        html: { type: 'string', description: 'The HTML content to display.' },
        kind: {
          type: 'string',
          enum: ['passage', 'question', 'diagram', 'feedback'],
          description: 'The kind of study content being displayed.',
        },
      },
      required: ['html', 'kind'],
      additionalProperties: false,
    },
  },
] as const;

export async function dispatchTool(db: DB, name: string, args: unknown): Promise<unknown> {
  switch (name) {
    case 'get_student_profile':
      return getProfile(db);

    case 'record_result': {
      const result = recordResultArgsSchema.parse(args);
      recordResult(db, result);
      const category = getProfile(db).categories.find(({ id }) => id === result.categoryId);
      return { ok: true, newMastery: category!.mastery };
    }

    case 'generate_question': {
      const params = generateQuestionArgsSchema.parse(args);
      const category = db
        .prepare('SELECT name, topics FROM categories WHERE id = ?')
        .get(params.categoryId) as { name: string; topics: string } | undefined;

      if (!category) throw new Error(`Unknown categoryId: ${params.categoryId}`);

      const topics = topicsSchema.parse(JSON.parse(category.topics) as unknown);
      let groundingText: string | undefined;

      if (params.useGrounding) {
        const [queryEmbedding] = await embed([[category.name, ...topics].join(' ')]);
        groundingText = searchMaterials(db, queryEmbedding, 3)
          .map(({ text }) => text)
          .join('\n\n');
      }

      const question = await generateQuestion({
        categoryId: params.categoryId,
        categoryName: category.name,
        topics,
        difficulty: params.difficulty,
        style: params.style,
        groundingText,
      });
      return QuestionSchema.parse(question);
    }

    case 'search_materials': {
      const { query, k } = searchMaterialsArgsSchema.parse(args);
      const [queryEmbedding] = await embed([query]);
      return searchMaterials(db, queryEmbedding, k);
    }

    case 'end_session_summary': {
      const summary = endSessionSummaryArgsSchema.parse(args);
      writeSessionSummary(db, summary);
      return { ok: true };
    }

    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
