import type { DB } from './db';

export type Taxonomy = {
  sections: {
    id: string;
    name: string;
    categories: { id: string; name: string; topics: string[] }[];
  }[];
};

export type CategoryProfile = {
  id: string;
  section: string;
  name: string;
  mastery: number;
  attempts: number;
  errorTypes: Record<string, number>;
};

export type Profile = {
  categories: CategoryProfile[];
  lastSession: { mode: string; summary: string; focusNext: string } | null;
  weakest: string[];
};

export type RecordResultInput = {
  categoryId: string;
  difficulty: 1 | 2 | 3;
  correct: boolean;
  errorType?: 'content' | 'reasoning' | 'misread';
  mode: string;
  note?: string;
};

export type SessionSummaryInput = {
  mode: string;
  summary: string;
  focusNext: string;
};

const MASTERY_MIN = 0.02;
const MASTERY_MAX = 0.98;

function clampMastery(m: number): number {
  return Math.min(MASTERY_MAX, Math.max(MASTERY_MIN, m));
}

/** Idempotent upsert of categories from the flattened taxonomy. */
export function seedTaxonomy(db: DB, taxonomy: Taxonomy): void {
  const stmt = db.prepare(`
    INSERT INTO categories (id, section, name, topics, mastery, attempts)
    VALUES (@id, @section, @name, @topics, 0.5, 0)
    ON CONFLICT(id) DO UPDATE SET section = excluded.section, name = excluded.name, topics = excluded.topics
  `);
  const insertAll = db.transaction((taxo: Taxonomy) => {
    for (const section of taxo.sections) {
      for (const category of section.categories) {
        stmt.run({
          id: category.id,
          section: section.id,
          name: category.name,
          topics: JSON.stringify(category.topics),
        });
      }
    }
  });
  insertAll(taxonomy);
}

/** Initializes mastery per category from section scores: (score - 118) / 14, clamped. */
export function seedSectionScores(db: DB, scores: Record<string, number>): void {
  const stmt = db.prepare(`UPDATE categories SET mastery = ? WHERE section = ?`);
  const updateAll = db.transaction((sc: Record<string, number>) => {
    for (const [section, score] of Object.entries(sc)) {
      const mastery = clampMastery((score - 118) / 14);
      stmt.run(mastery, section);
    }
  });
  updateAll(scores);
}

export function getProfile(db: DB): Profile {
  const categoryRows = db
    .prepare(`SELECT id, section, name, mastery, attempts FROM categories`)
    .all() as { id: string; section: string; name: string; mastery: number; attempts: number }[];

  const errorRows = db
    .prepare(
      `SELECT category_id as categoryId, error_type as errorType, COUNT(*) as count
       FROM results
       WHERE error_type IS NOT NULL
       GROUP BY category_id, error_type`
    )
    .all() as { categoryId: string; errorType: string; count: number }[];

  const errorTypesByCategory = new Map<string, Record<string, number>>();
  for (const row of errorRows) {
    const entry = errorTypesByCategory.get(row.categoryId) ?? {};
    entry[row.errorType] = row.count;
    errorTypesByCategory.set(row.categoryId, entry);
  }

  const categories: CategoryProfile[] = categoryRows.map((row) => ({
    id: row.id,
    section: row.section,
    name: row.name,
    mastery: row.mastery,
    attempts: row.attempts,
    errorTypes: errorTypesByCategory.get(row.id) ?? {},
  }));

  const lastSessionRow = db
    .prepare(`SELECT mode, summary, focus_next as focusNext FROM sessions ORDER BY id DESC LIMIT 1`)
    .get() as { mode: string; summary: string; focusNext: string } | undefined;

  const weakest = [...categories]
    .sort((a, b) => a.mastery - b.mastery || a.attempts - b.attempts)
    .slice(0, 5)
    .map((c) => c.id);

  return {
    categories,
    lastSession: lastSessionRow ?? null,
    weakest,
  };
}

export function recordResult(db: DB, r: RecordResultInput): void {
  const existing = db
    .prepare(`SELECT mastery, attempts FROM categories WHERE id = ?`)
    .get(r.categoryId) as { mastery: number; attempts: number } | undefined;

  if (!existing) {
    throw new Error(`Unknown categoryId: ${r.categoryId}`);
  }

  const outcome = r.correct
    ? 0.5 + r.difficulty / 6
    : (1 - r.difficulty / 6) * 0.3;
  const nextMastery = clampMastery(0.75 * existing.mastery + 0.25 * outcome);

  const record = db.transaction(() => {
    db.prepare(
      `INSERT INTO results (category_id, difficulty, correct, error_type, mode, note)
       VALUES (?, ?, ?, ?, ?, ?)`
    ).run(r.categoryId, r.difficulty, r.correct ? 1 : 0, r.errorType ?? null, r.mode, r.note ?? null);

    db.prepare(
      `UPDATE categories SET mastery = ?, attempts = attempts + 1 WHERE id = ?`
    ).run(nextMastery, r.categoryId);
  });
  record();
}

export function writeSessionSummary(db: DB, s: SessionSummaryInput): void {
  db.prepare(
    `INSERT INTO sessions (mode, summary, focus_next) VALUES (?, ?, ?)`
  ).run(s.mode, s.summary, s.focusNext);
}
