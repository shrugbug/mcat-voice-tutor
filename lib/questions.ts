import { z } from 'zod';

const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';

export type Difficulty = 1 | 2 | 3;

export type QuestionParams = {
  categoryId: string;
  categoryName: string;
  topics: string[];
  difficulty: Difficulty;
  style: 'discrete' | 'passage';
  groundingText?: string;
  avoidStems?: string[];
};

export const QuestionSchema = z.strictObject({
  passage: z.string().nullable(),
  stem: z.string(),
  options: z.array(z.string()).length(4),
  correctIndex: z.number().int().min(0).max(3),
  distractorRationales: z.array(z.string()).length(4),
  difficulty: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  categoryId: z.string(),
  explanation: z.string(),
});

export type Question = z.infer<typeof QuestionSchema>;

const difficultyGuidance: Record<Difficulty, string> = {
  1: 'AAMC medium',
  2: 'AAMC hard',
  3: 'harder than AAMC (discrimination question)',
};

export function buildQuestionPrompt(params: QuestionParams): string {
  const styleInstruction =
    params.style === 'passage'
      ? 'Write a 250-400 word passage describing a novel experimental setup in journal register.'
      : 'Write a discrete question with no passage; set passage to null.';
  const groundingInstruction = params.groundingText
    ? `SOURCE MATERIAL (ground the question in this text):\n${params.groundingText}`
    : '';
  const avoidInstruction = params.avoidStems?.length
    ? `STEMS TO AVOID (do not repeat or closely paraphrase):\n${params.avoidStems
        .map((stem) => `- ${stem}`)
        .join('\n')}`
    : '';

  return [
    'You author MCAT questions for a student scoring 93rd percentile.',
    'Write at the difficulty that discriminates 95th+ percentile students. Require correct application of second-order reasoning.',
    'Difficulty scale: 1=AAMC medium, 2=AAMC hard, 3=harder than AAMC (discrimination question).',
    `Target difficulty: ${params.difficulty}=${difficultyGuidance[params.difficulty]}.`,
    'Create exactly four plausible answer options. Each wrong option must encode a SPECIFIC common misconception and its index-aligned rationale must name that misconception. The rationale at correctIndex must be the correct-answer rationale and explain why it is right.',
    styleInstruction,
    'Never reuse or closely paraphrase famous practice questions. Ground the question in the provided source text when given.',
    `Category: ${params.categoryId} — ${params.categoryName}`,
    `Topics: ${params.topics.join(', ')}`,
    groundingInstruction,
    avoidInstruction,
  ]
    .filter(Boolean)
    .join('\n\n');
}

// This mirrors QuestionSchema using only the JSON Schema subset accepted by OpenAI strict mode.
// Exact array lengths are rechecked by QuestionSchema after generation.
const questionJsonSchema = {
  type: 'object',
  properties: {
    passage: { anyOf: [{ type: 'string' }, { type: 'null' }] },
    stem: { type: 'string' },
    options: {
      type: 'array',
      description: 'Exactly four answer options.',
      items: { type: 'string' },
    },
    correctIndex: { type: 'integer', enum: [0, 1, 2, 3] },
    distractorRationales: {
      type: 'array',
      description: 'Exactly four rationales, index-aligned with options.',
      items: { type: 'string' },
    },
    difficulty: { type: 'integer', enum: [1, 2, 3] },
    categoryId: { type: 'string' },
    explanation: { type: 'string' },
  },
  required: [
    'passage',
    'stem',
    'options',
    'correctIndex',
    'distractorRationales',
    'difficulty',
    'categoryId',
    'explanation',
  ],
  additionalProperties: false,
} as const;

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
};

async function requestQuestion(params: QuestionParams): Promise<unknown> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const model = process.env.QUESTION_MODEL;
  if (!model) throw new Error('QUESTION_MODEL is not set');

  const response = await fetch(CHAT_COMPLETIONS_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        { role: 'system', content: buildQuestionPrompt(params) },
        {
          role: 'user',
          content: 'Write one MCAT question. Return only the requested structured response.',
        },
      ],
      response_format: {
        type: 'json_schema',
        json_schema: {
          name: 'mcat_question',
          strict: true,
          schema: questionJsonSchema,
        },
      },
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI question request failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as ChatCompletionResponse;
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('OpenAI question response did not contain message content');
  }

  return JSON.parse(content) as unknown;
}

export async function generateQuestion(params: QuestionParams): Promise<Question> {
  let validationError: z.ZodError | undefined;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parsed = QuestionSchema.safeParse(await requestQuestion(params));
    if (parsed.success) return parsed.data;
    validationError = parsed.error;
  }

  throw validationError;
}
