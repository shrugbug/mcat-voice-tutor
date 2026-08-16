import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openDb, type DB } from '../lib/db';
import { formatIssues, type SentryIssue } from '../lib/sentry-issues';
import { fetchSentryIssues } from './fetch-sentry';
import { buildWriteBackPlan, pushWriteBack } from './push-feedback-status';

const CHAT_COMPLETIONS_URL = 'https://api.openai.com/v1/chat/completions';
const TUNING_DIR = 'docs/tuning';
const SENTINEL_DIR = join(homedir(), '.cron-sentinels');
const SENTINEL_FILE = join(SENTINEL_DIR, 'mcat-tune');

export type ResultRow = {
  categoryId: string;
  difficulty: number;
  correct: boolean;
  errorType: string | null;
  mode: string;
};

export type EpisodeRow = {
  categoryId: string;
  errorType: string | null;
  misconception: string | null;
};

export type TranscriptRow = {
  role: 'user' | 'bot' | 'system';
  text: string;
};

export type FeedbackRow = {
  id: number;
  kind: 'ui' | 'ux' | 'content' | 'other';
  quote: string;
  paraphrase: string | null;
  source?: string;
  orig_id?: number;
};

export type ToolErrorRow = {
  tool: string;
  message: string;
  count: number;
  source: string | null;
};

const MAX_TRANSCRIPT_LINES = 400;

export type TuningData = {
  date: string;
  results: ResultRow[];
  /** null when WS-A's episodes table doesn't exist yet in this db. */
  episodes: EpisodeRow[] | null;
  /** null when the transcripts table doesn't exist yet in this db. */
  transcript: TranscriptRow[] | null;
  /** null when the feedback table doesn't exist yet in this db. */
  feedback: FeedbackRow[] | null;
  /** null when the tool_errors table doesn't exist yet in this db. */
  toolErrors: ToolErrorRow[] | null;
};

function hasTable(db: DB, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
  return row !== undefined;
}

/** True when `table` carries a `source` column -- absent on a plain local db. */
function hasSourceColumn(db: DB, table: string): boolean {
  return (db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[]).some(
    (c) => c.name === 'source'
  );
}

/**
 * Instruction tuning must see prod dialogue only. The demo instance's transcripts are largely
 * ambient room audio the bot answered as if it were a student; tuning the examiner's
 * conversational behaviour on that would fit proposals to conversations no student had.
 */
function prodOnly(db: DB, table: string): string {
  return hasSourceColumn(db, table) ? `AND source = 'prod'` : '';
}

/**
 * SQLite stamps datetime('now') in UTC; this job runs at 23:00 US Central, which is already the
 * next UTC day. A calendar-day query therefore asks for the wrong day every night. Use an
 * explicit lookback instead.
 */
const WINDOW = `ts >= datetime('now','-24 hours') AND ts <= datetime('now')`;

/** Reads today's results (and episodes, if the table exists) for the tuning prompt. Read-only. */
export function gatherTuningData(db: DB): TuningData {
  const today = new Date().toISOString().slice(0, 10);

  const results = db
    .prepare(
      `SELECT category_id as categoryId, difficulty, correct, error_type as errorType, mode
       FROM results
       WHERE ${WINDOW} ${prodOnly(db, 'results')}`
    )
    .all()
    .map((r) => {
      const row = r as { categoryId: string; difficulty: number; correct: number; errorType: string | null; mode: string };
      return { ...row, correct: row.correct === 1 };
    }) as ResultRow[];

  const episodes = hasTable(db, 'episodes')
    ? (db
        .prepare(
          `SELECT category_id as categoryId, error_type as errorType, misconception
           FROM episodes
           WHERE ${WINDOW} ${prodOnly(db, 'episodes')}`
        )
        .all() as EpisodeRow[])
    : null;

  const transcript = hasTable(db, 'transcripts')
    ? (db
        .prepare(
          `SELECT role, text FROM (
             SELECT id, role, text FROM transcripts
             WHERE ${WINDOW} ${prodOnly(db, 'transcripts')}
             ORDER BY id DESC
             LIMIT ?
           ) ORDER BY id ASC`
        )
        .all(MAX_TRANSCRIPT_LINES) as TranscriptRow[])
    : null;

  const feedback = hasTable(db, 'feedback')
    ? (db
        .prepare(
          `SELECT id, kind, quote, paraphrase${hasSourceColumn(db, 'feedback') ? ', source, orig_id' : ''}
           FROM feedback
           WHERE ${WINDOW} AND status = 'new'`
        )
        .all() as FeedbackRow[])
    : null;

  const toolErrors = hasTable(db, 'tool_errors')
    ? (db
        .prepare(
          `SELECT tool, message, COUNT(*) AS count,
                  ${hasSourceColumn(db, 'tool_errors') ? 'group_concat(DISTINCT source)' : 'NULL'} AS source
           FROM tool_errors
           WHERE ${WINDOW}
           GROUP BY tool, message
           ORDER BY count DESC
           LIMIT 20`
        )
        .all() as ToolErrorRow[])
    : null;

  return { date: today, results, episodes, transcript, feedback, toolErrors };
}

/** Marks the given feedback rows as 'proposed' after their proposals have been written out. Read-write. */
export function markFeedbackProposed(db: DB, ids: number[]): void {
  if (ids.length === 0) return;
  const stmt = db.prepare(`UPDATE feedback SET status = 'proposed' WHERE id = ? AND status = 'new'`);
  const updateAll = db.transaction((rows: number[]) => {
    for (const id of rows) stmt.run(id);
  });
  updateAll(ids);
}

/**
 * Pure function: builds the tuning-proposal prompt from gathered data. Kept separate from
 * gatherTuningData (db I/O) and requestTuningProposals (network I/O) so it can be unit tested
 * without a live API call.
 */
export function buildTuningPrompt(
  data: TuningData,
  sentryIssues: SentryIssue[] | null = null
): string {
  const byCategory = new Map<string, { attempts: number; correct: number }>();
  const errorTypeCounts = new Map<string, number>();

  for (const r of data.results) {
    const entry = byCategory.get(r.categoryId) ?? { attempts: 0, correct: 0 };
    entry.attempts += 1;
    if (r.correct) entry.correct += 1;
    byCategory.set(r.categoryId, entry);

    if (r.errorType) {
      errorTypeCounts.set(r.errorType, (errorTypeCounts.get(r.errorType) ?? 0) + 1);
    }
  }

  const categoryLines = [...byCategory.entries()].map(([categoryId, s]) => {
    const accuracy = s.attempts > 0 ? Math.round((s.correct / s.attempts) * 100) : 0;
    return `- ${categoryId}: ${s.attempts} attempts, ${accuracy}% accuracy`;
  });

  const errorTypeLines = [...errorTypeCounts.entries()].map(
    ([type, count]) => `- ${type}: ${count}`
  );

  const misconceptionLines = (data.episodes ?? [])
    .filter((e) => e.misconception)
    .map((e) => `- ${e.categoryId} (${e.errorType ?? 'unknown error type'}): ${e.misconception}`);

  const dialogueLines = (data.transcript ?? []).map((line) => `${line.role}: ${line.text}`);

  const feedbackLines = (data.feedback ?? []).map(
    (f) => `- [${f.kind}] "${f.quote}"${f.paraphrase ? ` — ${f.paraphrase}` : ''}`
  );

  const sections = [
    'You are tuning the examiner instructions for an MCAT voice-study-bot based on today\'s real study data.',
    'Analyze the data below and propose SPECIFIC, ACTIONABLE tuning changes to the examiner instructions. Consider:',
    '- Is question difficulty too easy or too hard overall or per category?',
    '- Are there error_type misdiagnosis patterns (e.g. reasoning errors mislabeled as content errors)?',
    '- Is session pacing (attempts per session, time per question) a concern?',
    '- Do recorded misconceptions suggest the examiner should ground certain categories differently?',
    '- Read the DIALOGUE section below and critique examiner behavior directly: is it interrupting too much, over-explaining, letting imprecise answers slide instead of pressing for rigor, or mismanaging pacing?',
    'Ground every proposal in the data provided. Do not invent data not shown below. If data is too sparse to support a proposal, say so explicitly rather than guessing.',
    '',
    `Date: ${data.date}`,
    `Total attempts today: ${data.results.length}`,
    '',
    'Per-category accuracy:',
    categoryLines.length > 0 ? categoryLines.join('\n') : '(no results recorded today)',
    '',
    'Error type breakdown:',
    errorTypeLines.length > 0 ? errorTypeLines.join('\n') : '(no error types recorded today)',
    '',
    'Recent misconceptions:',
    data.episodes === null
      ? '(episodic memory not available yet — WS-A not merged)'
      : misconceptionLines.length > 0
        ? misconceptionLines.join('\n')
        : '(none recorded today)',
    '',
    'DIALOGUE (role-prefixed lines from today\'s session transcripts — use this to judge examiner conversational behavior, not just outcomes):',
    data.transcript === null
      ? '(transcript not available yet — transcripts table not present)'
      : dialogueLines.length > 0
        ? dialogueLines.join('\n')
        : '(no transcript recorded today)',
    '',
    'UI/UX FEEDBACK (voice-captured student comments about the interface or experience, quoted near-verbatim):',
    data.feedback === null
      ? '(feedback not available yet — feedback table not present)'
      : feedbackLines.length > 0
        ? feedbackLines.join('\n')
        : '(no feedback recorded today)',
    '',
    'BUGS (tool dispatch failures in the last 24h, from BOTH prod and demo — these contain no student content, so both sources count):',
    data.toolErrors === null
      ? '(tool_errors table not present)'
      : data.toolErrors.length > 0
        ? data.toolErrors
            .map((e) => `- ${e.tool}: ${e.message} (${e.count}x${e.source ? `, ${e.source}` : ''})`)
            .join('\n')
        : '(no tool errors in the last 24h)',
    '',
    'SENTRY (unresolved issues, last 24h — client crashes and API failures that tool_errors cannot see):',
    formatIssues(sentryIssues),
    '',
    'Output format: THREE separate markdown sections.',
    '1. "## Instruction-tuning proposals" — a numbered list of proposed changes to lib/instructions.ts (the examiner prompt) only, each with a one-line rationale citing the specific data point that motivated it. Do NOT rewrite the instructions yourself — only propose changes for a human to apply.',
    '2. "## UI/UX proposals" — a numbered list, one per UI/UX feedback item above (omit this section entirely if there is no feedback today). Each proposal must be concrete and minimal, and reference the app\'s actual components where relevant: ContentPanel, MasterySidebar, the six render_view components (flashcard_deck, answer_grid, timer, mastery_chart, data_table, passage), or the landing page. Keep these clearly separate from the instruction-tuning proposals — they are about the app\'s UI code, not lib/instructions.ts.',
    '3. "## Bugs" — a numbered list, one per distinct tool failure above, each naming the likely cause in the app code and the smallest fix. Omit this section entirely if there are no bugs. These are defects, not tuning suggestions — keep them separate from both other sections.',
  ];

  return sections.join('\n');
}

type ChatCompletionResponse = {
  choices?: Array<{ message?: { content?: string | null } }>;
};

async function requestTuningProposals(prompt: string): Promise<string> {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY is not set');

  const model = process.env.QUESTION_MODEL || 'gpt-5.1';

  const response = await fetch(CHAT_COMPLETIONS_URL, {
    method: 'POST',
    signal: AbortSignal.timeout(60_000),
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({
      model,
      messages: [
        {
          role: 'system',
          content: 'You are an expert MCAT tutoring-system tuner. Be concise, specific, and data-grounded.',
        },
        { role: 'user', content: prompt },
      ],
    }),
  });

  if (!response.ok) {
    throw new Error(`OpenAI tuning request failed: ${response.status} ${await response.text()}`);
  }

  const body = (await response.json()) as ChatCompletionResponse;
  const content = body.choices?.[0]?.message?.content;
  if (typeof content !== 'string') {
    throw new Error('OpenAI tuning response did not contain message content');
  }
  return content;
}

function notify(message: string): void {
  try {
    execFileSync('osascript', [
      '-e',
      `display notification ${JSON.stringify(message)} with title "MCAT Jarvis"`,
    ]);
  } catch (error) {
    console.error(
      `notification failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

async function main(): Promise<void> {
  const sentryIssues = await fetchSentryIssues();
  const db = openDb();
  let data: TuningData;
  try {
    data = gatherTuningData(db);
  } finally {
    db.close();
  }

  const prompt = buildTuningPrompt(data, sentryIssues);
  const proposals = await requestTuningProposals(prompt);

  const header = [
    `# Tuning proposal — ${data.date}`,
    '',
    `Based on ${data.results.length} attempt(s) today. Generated by scripts/nightly-tune.ts — this file is a proposal only; lib/instructions.ts is NOT modified automatically.`,
    '',
  ].join('\n');

  const markdown = `${header}${proposals}\n`;

  mkdirSync(TUNING_DIR, { recursive: true });
  const outPath = join(TUNING_DIR, `proposal-${data.date}.md`);
  writeFileSync(outPath, markdown, 'utf8');

  // Only after the proposal file exists: a crash between generating and writing must not consume
  // the feedback.
  if (data.feedback && data.feedback.length > 0) {
    const rows = data.feedback as unknown as { id: number; source?: string; orig_id?: number }[];
    if (rows[0]?.source !== undefined) {
      pushWriteBack(buildWriteBackPlan(rows.map((r) => ({ source: r.source!, orig_id: r.orig_id! }))));
    } else {
      const writeDb = openDb();
      try {
        markFeedbackProposed(writeDb, rows.map((r) => r.id));
      } finally {
        writeDb.close();
      }
    }
  }

  notify(`Tuning proposal ready: ${data.results.length} attempts analyzed.`);

  console.log(markdown);
  console.log(`\nWritten to ${outPath}`);

  mkdirSync(SENTINEL_DIR, { recursive: true });
  writeFileSync(SENTINEL_FILE, new Date().toISOString(), 'utf8');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
