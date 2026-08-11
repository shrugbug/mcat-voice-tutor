/**
 * Marks feedback rows 'proposed' in the ORIGIN databases on the VPS.
 *
 * The combined db is rebuilt nightly, so a status written there evaporates and the same feedback
 * would regenerate proposals every night forever. This is the only step in the tuning pipeline
 * that mutates production: it touches feedback.status and nothing else.
 */
import { execFileSync } from 'node:child_process';

const HOST = process.env.MCAT_VPS_HOST ?? 'vps';
const APP_DIR = '/root/repos/mcat';
const DB_BY_SOURCE: Record<string, string> = { prod: 'data/mcat.db', demo: 'data/demo.db' };

export function buildWriteBackPlan(rows: { source: string; orig_id: number }[]): Record<string, number[]> {
  const plan: Record<string, number[]> = {};
  for (const row of rows) {
    if (!row.source) continue;
    (plan[row.source] ??= []).push(row.orig_id);
  }
  return plan;
}

export function buildUpdateSql(ids: number[]): string {
  if (ids.length === 0) return '';
  for (const id of ids) {
    if (!Number.isInteger(id)) throw new Error(`Refusing to interpolate a non-integer id: ${String(id)}`);
  }
  return `UPDATE feedback SET status='proposed' WHERE id IN (${ids.join(',')}) AND status='new'`;
}

export function pushWriteBack(plan: Record<string, number[]>): void {
  for (const [source, ids] of Object.entries(plan)) {
    const dbPath = DB_BY_SOURCE[source];
    if (!dbPath) {
      console.warn(`Unknown source '${source}' -- skipping write-back.`);
      continue;
    }
    const sql = buildUpdateSql(ids);
    if (!sql) continue;
    execFileSync('ssh', [HOST, `cd ${APP_DIR} && sqlite3 ${dbPath} "${sql}"`], { stdio: 'inherit' });
    console.log(`Marked ${ids.length} feedback row(s) proposed in ${source}.`);
  }
}
