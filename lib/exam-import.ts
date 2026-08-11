/**
 * Import of an AAMC full-length score report (per-question CSV) into the student model.
 *
 * These are questions the examiner never asked, so every imported row is tagged
 * `mode = 'exam_import'`. That keeps them out of examiner-behaviour tuning while still letting
 * them inform mastery -- the same source-tagging discipline the nightly tuner uses to separate
 * prod from demo data.
 *
 * Pure functions only: parsing, mapping and the mastery formula live here so they can be tested
 * without a database or a file. All I/O lives in scripts/import-exam.ts.
 */

/** App difficulty is a 1-3 integer (see lib/instructions.ts, which caps escalation at 3). */
export type Difficulty = 1 | 2 | 3;

export interface ExamRow {
  question: number;
  categoryId: string;
  correct: boolean;
  difficulty: Difficulty;
  seconds: number | null;
  flagged: boolean;
}

/**
 * CARS questions carry no content category -- the AAMC report puts the CARS skill in
 * `Skill_Description` instead. These three strings are the entire CARS vocabulary in the report
 * and map onto the three `cars_*` taxonomy ids.
 */
const CARS_SKILL_TO_CATEGORY: Record<string, string> = {
  'Foundations of Comprehension': 'cars_comprehension',
  'Reasoning Within the Text': 'cars_within_text',
  'Reasoning Beyond the Text': 'cars_beyond_text',
};

const DIFFICULTY_BY_LABEL: Record<string, Difficulty> = {
  Easy: 1,
  Moderate: 2,
  Difficult: 3,
  // The report's fourth band has no separate app level; it collapses onto the 3 cap.
  Expert: 3,
};

/**
 * Minimal RFC 4180 parser. The report quotes any field containing a comma -- content-category
 * descriptions such as "Atoms, nuclear decay, electronic structure..." -- so splitting on commas
 * silently shifts every later column on those rows.
 */
export function parseCsv(text: string): Record<string, string>[] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i += 1;
        } else {
          quoted = false;
        }
      } else {
        field += char;
      }
      continue;
    }

    if (char === '"') {
      quoted = true;
    } else if (char === ',') {
      row.push(field);
      field = '';
    } else if (char === '\n') {
      row.push(field);
      rows.push(row);
      row = [];
      field = '';
    } else if (char !== '\r') {
      field += char;
    }
  }

  if (field !== '' || row.length > 0) {
    row.push(field);
    rows.push(row);
  }

  const [header, ...body] = rows;
  if (!header) return [];

  return body
    .filter((cells) => cells.some((cell) => cell.trim() !== ''))
    .map((cells) => Object.fromEntries(header.map((key, index) => [key.trim(), cells[index] ?? ''])));
}

/** "3 mins 3 secs" / "18 secs" / "2 mins 1 sec" -> seconds. Null when unparseable. */
export function parseTimeSpent(value: string): number | null {
  const minutes = /(\d+)\s*min/.exec(value);
  const seconds = /(\d+)\s*sec/.exec(value);
  if (!minutes && !seconds) return null;
  return Number(minutes?.[1] ?? 0) * 60 + Number(seconds?.[1] ?? 0);
}

/**
 * AAMC exports the same report in at least three shapes, and they disagree on every code column.
 * Observed across four real reports:
 *
 *   content category   'Content Category 5D'  |  'CC5D'
 *   CARS skill         'Reasoning Within the Text'  |  'Skill: Reasoning Within the Text'
 *                      |  'SIRS Skill 2: Scientific Reasoning'
 *   CARS category col  'CARS'  |  '' (blank)  |  a discipline code ('HUM', 'PSY', 'ECO', 'HIS')
 *
 * Normalising here rather than per-caller is what keeps a format change from silently dropping a
 * whole section: exam 5's 53 CARS questions map only because of the 'Skill: ' prefix rule.
 */
function stripLabelPrefix(value: string): string {
  // 'Skill: Foo' -> 'Foo'; 'SIRS Skill 2: Foo' -> 'Foo'; 'Foo' -> 'Foo'
  return value.replace(/^(SIRS\s+)?Skill\s*\d*\s*:\s*/i, '').trim();
}

/**
 * Resolves a report row onto a taxonomy category id, or null when the row belongs to no known
 * category. Returning null rather than guessing matters: a silently mis-mapped question would
 * move the mastery of a category the student never attempted.
 */
export function resolveCategoryId(row: Record<string, string>): string | null {
  if (row.Section?.startsWith('Critical')) {
    return CARS_SKILL_TO_CATEGORY[stripLabelPrefix(row.Skill_Description ?? '')] ?? null;
  }

  const code = row.Content_Category_Code?.trim() ?? '';
  const match = /^Content Category\s+(\d+[A-Z])$/.exec(code) ?? /^CC(\d+[A-Z])$/.exec(code);
  return match ? match[1] : null;
}

export function toExamRow(row: Record<string, string>): ExamRow | null {
  const categoryId = resolveCategoryId(row);
  const difficulty = DIFFICULTY_BY_LABEL[row.Difficulty?.trim() ?? ''];
  const question = Number(row.Question);

  if (!categoryId || !difficulty || !Number.isInteger(question)) return null;

  return {
    question,
    categoryId,
    correct: row.Result?.trim() === 'Correct',
    difficulty,
    seconds: parseTimeSpent(row.Time_Spent ?? ''),
    flagged: row.Flagged?.trim() === 'Yes',
  };
}

/**
 * Mastery with shrinkage toward 0.5: (correct + 2) / (attempts + 4).
 *
 * Raw accuracy is unusable at this sample size -- a full-length exam gives some categories a
 * single question, and 1/1 is not evidence of mastery 1.0 any more than 0/4 is evidence of 0.0.
 * The +2/+4 prior is equivalent to four prior coin-flip attempts, so small samples stay near 0.5
 * and only sustained evidence moves a category to the extremes.
 */
export function shrunkMastery(correct: number, attempts: number): number {
  if (attempts < 0 || correct < 0 || correct > attempts) {
    throw new Error(`Invalid mastery input: ${correct}/${attempts}`);
  }
  return (correct + 2) / (attempts + 4);
}

/** Human-readable provenance stored on each imported result row. */
export function buildNote(examId: string, row: ExamRow): string {
  const parts = [`${examId} q${row.question}`];
  if (row.seconds !== null) parts.push(`${row.seconds}s`);
  if (row.flagged) parts.push('flagged');
  return parts.join(' | ');
}
