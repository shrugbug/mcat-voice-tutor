import { execFileSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { openDb } from '../lib/db';
import { buildBriefing } from '../lib/briefing';
import { fetchSentryIssues } from './fetch-sentry';

const EXAM_DATE = process.env.EXAM_DATE || '2026-08-23';
const BRIEFINGS_DIR = 'docs/briefings';
const SENTINEL_DIR = join(homedir(), '.cron-sentinels');
const SENTINEL_FILE = join(SENTINEL_DIR, 'mcat-briefing');

function notify(message: string): void {
  try {
    execFileSync('osascript', [
      '-e',
      `display notification ${JSON.stringify(message)} with title "MCAT Jarvis"`,
    ]);
  } catch (error) {
    // Non-fatal: notifications only work on macOS with a logged-in session (e.g. not over ssh
    // without a display). The briefing itself must still succeed.
    console.error(
      `notification failed (non-fatal): ${error instanceof Error ? error.message : String(error)}`
    );
  }
}

function summarize(markdown: string): string {
  const daysLine = markdown.split('\n').find((line) => line.startsWith('**'));
  return daysLine ? daysLine.replace(/\*\*/g, '') : 'Briefing ready.';
}

async function main(): Promise<void> {
  const sentryIssues = await fetchSentryIssues();
  const db = openDb();
  let markdown: string;
  try {
    markdown = buildBriefing(db, EXAM_DATE, sentryIssues?.map((issue) => issue.title) ?? []);
  } finally {
    db.close();
  }

  const today = new Date().toISOString().slice(0, 10);
  mkdirSync(BRIEFINGS_DIR, { recursive: true });
  const outPath = join(BRIEFINGS_DIR, `${today}.md`);
  writeFileSync(outPath, markdown, 'utf8');

  notify(summarize(markdown));

  console.log(markdown);
  console.log(`\nWritten to ${outPath}`);

  mkdirSync(SENTINEL_DIR, { recursive: true });
  writeFileSync(SENTINEL_FILE, new Date().toISOString(), 'utf8');
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
