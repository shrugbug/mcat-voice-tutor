import type { DB } from './db';

type WeakCategory = {
  id: string;
  section: string;
  name: string;
  mastery: number;
  attempts: number;
};

type DueCategory = {
  id: string;
  section: string;
  name: string;
  mastery: number;
  dueAt: string | null;
};

type YesterdayStats = {
  count: number;
  accuracy: number | null;
};

type Misconception = {
  categoryId: string;
  misconception: string;
  ts: string;
};

/** True if `table` exists in the sqlite db (used to tolerate WS-A's episodes table not existing yet). */
function hasTable(db: DB, table: string): boolean {
  const row = db
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
    .get(table);
  return row !== undefined;
}

/** True if `table.column` exists (used to tolerate WS-A's categories.due_at not existing yet). */
function hasColumn(db: DB, table: string, column: string): boolean {
  const rows = db.prepare(`PRAGMA table_info(${table})`).all() as { name: string }[];
  return rows.some((r) => r.name === column);
}

/** Whole-day count from "today" (UTC, date-only) to examDate ('YYYY-MM-DD'). Negative once the exam has passed. */
function daysToExam(examDate: string): number {
  const now = new Date();
  const todayUTC = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  const examUTC = new Date(`${examDate}T00:00:00Z`).getTime();
  return Math.round((examUTC - todayUTC) / 86_400_000);
}

function getWeakestCategories(db: DB, limit: number): WeakCategory[] {
  return db
    .prepare(
      `SELECT id, section, name, mastery, attempts FROM categories
       ORDER BY mastery ASC, attempts ASC
       LIMIT ?`
    )
    .all(limit) as WeakCategory[];
}

/** Mirrors WS-A's planned getDueCategories semantics (due_at <= now OR NULL) without importing lib/student.ts,
 * since WS-A may not have merged yet. Returns [] when categories.due_at doesn't exist. */
function getDueCategories(db: DB, limit: number): DueCategory[] {
  if (!hasColumn(db, 'categories', 'due_at')) return [];
  return db
    .prepare(
      `SELECT id, section, name, mastery, due_at as dueAt FROM categories
       WHERE due_at IS NULL OR due_at <= datetime('now')
       ORDER BY mastery ASC
       LIMIT ?`
    )
    .all(limit) as DueCategory[];
}

function getYesterdayStats(db: DB): YesterdayStats {
  const row = db
    .prepare(
      `SELECT COUNT(*) as count, SUM(correct) as correctSum FROM results
       WHERE date(ts) = date('now', '-1 day')`
    )
    .get() as { count: number; correctSum: number | null };
  return {
    count: row.count,
    accuracy: row.count > 0 ? (row.correctSum ?? 0) / row.count : null,
  };
}

/** Returns [] when the episodes table doesn't exist yet (WS-A not merged). */
function getRecentMisconceptions(db: DB, limit: number): Misconception[] {
  if (!hasTable(db, 'episodes')) return [];
  return db
    .prepare(
      `SELECT category_id as categoryId, misconception, ts FROM episodes
       WHERE misconception IS NOT NULL
       ORDER BY ts DESC
       LIMIT ?`
    )
    .all(limit) as Misconception[];
}

function targetDifficulty(mastery: number): 1 | 2 | 3 {
  if (mastery < 0.35) return 1;
  if (mastery < 0.65) return 2;
  return 3;
}

function describeCategory(c: { id: string; name: string }): string {
  return `${c.name} (${c.id})`;
}

function buildPlan(due: DueCategory[], weakest: WeakCategory[]): string[] {
  const picks: { id: string; name: string; mastery: number; reason: string }[] = [];

  if (due.length > 0) {
    picks.push({ ...due[0], reason: 'due for review' });
  }
  for (const w of weakest) {
    if (picks.length >= 2) break;
    if (picks.some((p) => p.id === w.id)) continue;
    picks.push({ ...w, reason: 'weakest category' });
  }

  if (picks.length === 0) {
    return ['No categories seeded yet — run `npm run seed` before the next session.'];
  }

  return picks.map(
    (p, i) =>
      `Block ${i + 1} (20 min): Drill ${describeCategory(p)} at difficulty ${targetDifficulty(
        p.mastery
      )} — ${p.reason}, mastery ${p.mastery.toFixed(2)}.`
  );
}

/**
 * Builds the morning briefing markdown. Must work whether or not WS-A's `due_at` column and
 * `episodes` table exist yet (checked via PRAGMA table_info / sqlite_master), since WS-A is
 * being built in a parallel worktree and may not have merged.
 */
export function buildBriefing(db: DB, examDate: string, bugs: string[] = []): string {
  const today = new Date().toISOString().slice(0, 10);
  const days = daysToExam(examDate);
  const weakest = getWeakestCategories(db, 5);
  const due = getDueCategories(db, 5);
  const yesterday = getYesterdayStats(db);
  const misconceptions = getRecentMisconceptions(db, 2);

  const lines: string[] = [];
  lines.push(`# MCAT Morning Briefing — ${today}`);
  lines.push('');
  lines.push(
    days >= 0
      ? `**${days} day${days === 1 ? '' : 's'} to exam** (test date ${examDate})`
      : `**Exam date ${examDate} has passed.**`
  );
  lines.push('');

  lines.push('## Weakest categories');
  if (weakest.length === 0) {
    lines.push('No categories seeded yet.');
  } else {
    weakest.forEach((c, i) => {
      lines.push(
        `${i + 1}. ${describeCategory(c)} — mastery ${c.mastery.toFixed(2)}, ${c.attempts} attempts`
      );
    });
  }
  lines.push('');

  lines.push('## Due for review');
  if (!hasColumn(db, 'categories', 'due_at')) {
    lines.push('_Spaced-repetition tracking not yet available (WS-A pending)._');
  } else if (due.length === 0) {
    lines.push('Nothing due today.');
  } else {
    due.forEach((c) => {
      lines.push(`- ${describeCategory(c)} — mastery ${c.mastery.toFixed(2)}, due ${c.dueAt ?? 'now'}`);
    });
  }
  lines.push('');

  lines.push("## Yesterday");
  if (yesterday.count === 0) {
    lines.push('No questions attempted yesterday.');
  } else {
    lines.push(
      `${yesterday.count} question${yesterday.count === 1 ? '' : 's'} attempted, ${(
        (yesterday.accuracy ?? 0) * 100
      ).toFixed(0)}% accuracy.`
    );
  }
  lines.push('');

  lines.push('## Recent misconceptions');
  if (!hasTable(db, 'episodes')) {
    lines.push('_Episodic memory not yet available (WS-A pending)._');
  } else if (misconceptions.length === 0) {
    lines.push('None recorded recently.');
  } else {
    misconceptions.forEach((m) => {
      lines.push(`- ${m.categoryId}: ${m.misconception}`);
    });
  }
  lines.push('');

  if (bugs.length > 0) {
    lines.push('## Open bugs');
    for (const bug of bugs.slice(0, 2)) {
      lines.push(`- ${bug}`);
    }
    lines.push('');
  }

  lines.push("## Today's plan");
  for (const line of buildPlan(due, weakest)) {
    lines.push(`- ${line}`);
  }
  lines.push('');

  return lines.join('\n');
}
