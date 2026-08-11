import { z } from 'zod';

export const VIEW_COMPONENT_NAMES = [
  'flashcard_deck',
  'answer_grid',
  'timer',
  'mastery_chart',
  'data_table',
  'passage',
] as const;

const flashcardDeckSchema = z.object({
  component: z.literal('flashcard_deck'),
  cards: z
    .array(
      z.object({
        front: z.string(),
        back: z.string(),
      })
    )
    .min(1)
    .max(50),
  title: z.string().optional(),
});

const answerGridSchema = z
  .object({
    component: z.literal('answer_grid'),
    /** The question stem, shown above the options. Optional so older payloads still render. */
    stem: z.string().max(4000).optional(),
    options: z.array(z.string()).length(4),
    revealed: z.boolean(),
    correctIndex: z.union([z.literal(0), z.literal(1), z.literal(2), z.literal(3)]).optional(),
  })
  .superRefine((view, context) => {
    if (view.revealed && view.correctIndex === undefined) {
      context.addIssue({
        code: 'custom',
        path: ['correctIndex'],
        message: 'correctIndex is required when revealed is true',
      });
    }
  });

const timerSchema = z.object({
  component: z.literal('timer'),
  seconds: z.number().int().positive().max(7200),
  label: z.string().optional(),
  running: z.boolean(),
});

const masteryChartSchema = z.object({
  component: z.literal('mastery_chart'),
  categories: z
    .array(
      z.object({
        id: z.string(),
        name: z.string(),
        mastery: z.number().min(0).max(1),
      })
    )
    .min(1)
    .max(40),
});

const dataTableSchema = z
  .object({
    component: z.literal('data_table'),
    headers: z.array(z.string()).min(1).max(8),
    rows: z.array(z.array(z.string())).max(30),
    title: z.string().optional(),
  })
  .superRefine((view, context) => {
    view.rows.forEach((row, index) => {
      if (row.length !== view.headers.length) {
        context.addIssue({
          code: 'custom',
          path: ['rows', index],
          message: 'Each row must have the same number of cells as the headers',
        });
      }
    });
  });

const passageSchema = z.object({
  component: z.literal('passage'),
  html: z.string(),
  title: z.string().optional(),
});

export const ViewSpecSchema = z.discriminatedUnion('component', [
  flashcardDeckSchema,
  answerGridSchema,
  timerSchema,
  masteryChartSchema,
  dataTableSchema,
  passageSchema,
]);

export type ViewSpec = z.infer<typeof ViewSpecSchema>;
