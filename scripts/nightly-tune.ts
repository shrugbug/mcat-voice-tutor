import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openDb, type DB } from '../lib/db';

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

const MAX_TRANSCRIPT_LINES = 400;

export type TuningData = {
  date: string;
  results: ResultRow[];
  /** null when WS-A's episodes table doesn't exist yet in this db. */
  episodes: EpisodeRow[] | null;
  /** null when the transcripts table doesn't exist yet in this db. */
  transcript: TranscriptRow[] | null;
};

function hasTable(db: DB, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
  return row !== undefined;
}

/** Reads today's results (and episodes, if the table exists) for the tuning prompt. Read-only. */
export function gatherTuningData(db: DB): TuningData {
  const today = new Date().toISOString().slice(0, 10);

  const results = db
    .prepare(
      `SELECT category_id as categoryId, difficulty, correct, error_type as errorType, mode
       FROM results
       WHERE date(ts) = date('now')`
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
           WHERE date(ts) = date('now')`
        )
        .all() as EpisodeRow[])
    : null;

  const transcript = hasTable(db, 'transcripts')
    ? (db
        .prepare(
          `SELECT role, text FROM (
             SELECT id, role, text FROM transcripts
             WHERE date(ts) = date('now')
             ORDER BY id DESC
             LIMIT ?
           ) ORDER BY id ASC`
        )
        .all(MAX_TRANSCRIPT_LINES) as TranscriptRow[])
    : null;

  return { date: today, results, episodes, transcript };
}

/**
 * Pure function: builds the tuning-proposal prompt from gathered data. Kept separate from
 * gatherTuningData (db I/O) and requestTuningProposals (network I/O) so it can be unit tested
 * without a live API call.
 */
export function buildTuningPrompt(data: TuningData): string {
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
    'Output format: a markdown list of numbered proposals, each with a one-line rationale citing the specific data point that motivated it. Do NOT rewrite the instructions yourself — only propose changes for a human to apply.',
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
  const db = openDb();
  let data: TuningData;
  try {
    data = gatherTuningData(db);
  } finally {
    db.close();
  }

  const prompt = buildTuningPrompt(data);
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
