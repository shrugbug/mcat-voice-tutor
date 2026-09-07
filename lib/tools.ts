import { z } from 'zod';
import type { DB } from './db';
import { embed } from './embeddings';
import { generateQuestion, QuestionSchema } from './questions';
import { cosine, fromBlob, searchMaterials } from './rag';
import { getProfile, recordEpisode, recordResult, writeSessionSummary } from './student';
import { VIEW_COMPONENT_NAMES } from './views';

const identifierSchema = z.string().max(64);
const querySchema = z.string().max(4000);
const storedTextSchema = z.string().max(8000);
const noteSchema = z.string().max(2000);

const recordResultArgsSchema = z.strictObject({
  categoryId: identifierSchema,
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  correct: z.boolean(),
  errorType: z.enum(['content', 'reasoning', 'misread']).optional(),
  mode: identifierSchema,
  note: noteSchema.optional(),
});

const recordEpisodeArgsSchema = z.strictObject({
  categoryId: identifierSchema,
  stem: storedTextSchema,
  options: z.tuple([querySchema, querySchema, querySchema, querySchema]),
  correctIndex: z.number().int().min(0).max(3),
  chosenIndex: z.number().int().min(0).max(3),
  errorType: identifierSchema.optional(),
  misconception: noteSchema.optional(),
  studentReasoning: storedTextSchema.optional(),
});

const recallSimilarMistakesArgsSchema = z.strictObject({
  query: querySchema,
  k: z.number().int().positive().max(5).optional(),
});

const generateQuestionArgsSchema = z.strictObject({
  categoryId: identifierSchema,
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  style: z.enum(['discrete', 'passage']),
  useGrounding: z.boolean().optional(),
});

const searchMaterialsArgsSchema = z.strictObject({
  query: querySchema,
  k: z.number().int().positive().max(5).optional(),
});

const recordFeedbackArgsSchema = z.strictObject({
  kind: z.enum(['ui', 'ux', 'content', 'other']),
  quote: z.string().min(1).max(1000),
  paraphrase: noteSchema.optional(),
});

const endSessionSummaryArgsSchema = z.strictObject({
  mode: identifierSchema,
  summary: storedTextSchema,
  focusNext: querySchema,
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
    name: 'record_episode',
    description:
      'Use after every missed question, alongside record_result, to save the question and diagnosed misconception for later recall.',
    parameters: {
      type: 'object',
      properties: {
        categoryId: { type: 'string', description: 'The tested MCAT category ID.' },
        stem: { type: 'string', description: 'The complete question stem.' },
        options: {
          type: 'array',
          items: { type: 'string' },
          minItems: 4,
          maxItems: 4,
          description: 'The four answer options in display order.',
        },
        correctIndex: {
          type: 'integer',
          minimum: 0,
          maximum: 3,
          description: 'Zero-based index of the correct option.',
        },
        chosenIndex: {
          type: 'integer',
          minimum: 0,
          maximum: 3,
          description: 'Zero-based index of the option the student chose.',
        },
        errorType: { type: 'string', description: 'Optional diagnosed error type.' },
        misconception: { type: 'string', description: 'Optional concise misconception diagnosis.' },
        studentReasoning: { type: 'string', description: 'Optional summary of the student reasoning.' },
      },
      required: ['categoryId', 'stem', 'options', 'correctIndex', 'chosenIndex'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'recall_similar_mistakes',
    description:
      'Use when opening a topic to recall the student\'s most semantically similar prior mistakes.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'The topic or concept to compare with prior mistakes.' },
        k: {
          type: 'integer',
          minimum: 1,
          maximum: 5,
          description: 'Optional number of similar mistakes to return, up to five.',
        },
      },
      required: ['query'],
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
        k: { type: 'integer', minimum: 1, maximum: 5, description: 'Optional maximum number of chunks.' },
      },
      required: ['query'],
      additionalProperties: false,
    },
  },
  {
    type: 'function',
    name: 'record_feedback',
    description:
      "Store the student's feedback about the interface or experience the moment they voice it — a complaint, wish, or suggestion about how the app looks/works. quote = their words as close to verbatim as the transcript allows.",
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['ui', 'ux', 'content', 'other'],
          description: 'The category of feedback.',
        },
        quote: {
          type: 'string',
          description: "The student's words, as close to verbatim as the transcript allows (1-1000 characters).",
        },
        paraphrase: { type: 'string', description: 'Optional one-line paraphrase of the feedback.' },
      },
      required: ['kind', 'quote'],
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
    name: 'render_view',
    description: 'Replace the main study panel with one registered interactive view.',
    parameters: {
      type: 'object',
      properties: {
        component: {
          type: 'string',
          enum: VIEW_COMPONENT_NAMES,
          description: 'The registered component to render.',
        },
        props: {
          type: 'object',
          description: 'The component props. These are validated strictly in the study interface.',
          additionalProperties: true,
        },
      },
      required: ['component', 'props'],
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

export type SimilarMistake = {
  stem: string;
  misconception: string | null;
  errorType: string | null;
  ts: string;
  categoryId: string;
};

export function recallSimilarMistakes(
  db: DB,
  queryEmbedding: Float32Array,
  k = 5
): SimilarMistake[] {
  const rows = db
    .prepare(
      `SELECT stem, misconception, error_type as errorType, ts,
              category_id as categoryId, embedding
       FROM episodes
       WHERE embedding IS NOT NULL`
    )
    .all() as (SimilarMistake & { embedding: Buffer })[];

  return rows
    .map(({ embedding, ...episode }) => ({
      episode,
      score: cosine(queryEmbedding, fromBlob(embedding)),
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map(({ episode }) => episode);
}

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

    case 'record_episode': {
      const episode = recordEpisodeArgsSchema.parse(args);
      const embeddingText = [episode.stem, episode.misconception].filter(Boolean).join('\n\n');
      const [embedding] = await embed([embeddingText]);
      recordEpisode(db, { ...episode, embedding });
      return { ok: true };
    }

    case 'recall_similar_mistakes': {
      const { query, k } = recallSimilarMistakesArgsSchema.parse(args);
      const [queryEmbedding] = await embed([query]);
      return recallSimilarMistakes(db, queryEmbedding, k);
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

    case 'record_feedback': {
      const feedback = recordFeedbackArgsSchema.parse(args);
      db.prepare(
        `INSERT INTO feedback (kind, quote, paraphrase) VALUES (@kind, @quote, @paraphrase)`
      ).run({ kind: feedback.kind, quote: feedback.quote, paraphrase: feedback.paraphrase ?? null });
      return { ok: true };
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
