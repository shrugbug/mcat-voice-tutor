import { describe, expect, test } from 'vitest';
import {
  buildNote,
  parseCsv,
  parseTimeSpent,
  resolveCategoryId,
  shrunkMastery,
  toExamRow,
} from '../lib/exam-import';

/**
 * Pure-logic tests for AAMC score-report import. The fixtures below are copied verbatim from a
 * real report (~/Downloads/mcat_exam4_score_report.csv, 230 questions) rather than
 * invented, because the failure mode here is a fixture that agrees with the parser while
 * disagreeing with what AAMC actually emits.
 */

describe('parseCsv', () => {
  test('keeps quoted commas inside one field', () => {
    // This row is the reason a naive split(',') is wrong: the content-category description
    // contains two commas, which would shift every subsequent column.
    const csv =
      'Question,Content_Category_Code,Content_Category_Description,Discipline_Description\n' +
      '3,Content Category 4E,"Atoms, nuclear decay, electronic structure, and atomic chemical behavior",General Chemistry\n';
    const [row] = parseCsv(csv);

    expect(row.Content_Category_Description).toBe(
      'Atoms, nuclear decay, electronic structure, and atomic chemical behavior'
    );
    expect(row.Discipline_Description).toBe('General Chemistry');
  });

  test('handles escaped double quotes and trailing newline', () => {
    const [row] = parseCsv('A,B\n1,"say ""hi"" now"\n');
    expect(row.B).toBe('say "hi" now');
  });

  test('ignores blank trailing lines', () => {
    expect(parseCsv('A\n1\n\n')).toHaveLength(1);
  });
});

describe('parseTimeSpent', () => {
  test.each([
    ['3 mins 3 secs', 183],
    ['18 secs', 18],
    ['2 mins 1 sec', 121],
    ['', null],
  ])('%s -> %s', (input, expected) => {
    expect(parseTimeSpent(input)).toBe(expected);
  });
});

describe('resolveCategoryId', () => {
  test('strips the "Content Category" prefix onto a taxonomy id', () => {
    expect(resolveCategoryId({ Section: 'Chemical and Physical', Content_Category_Code: 'Content Category 5E' })).toBe(
      '5E'
    );
  });

  test('maps CARS rows by skill, since they carry no content category', () => {
    const cars = (skill: string) =>
      resolveCategoryId({
        Section: 'Critical Analysis and Reasoning Skills',
        Content_Category_Code: 'CARS',
        Skill_Description: skill,
      });

    expect(cars('Foundations of Comprehension')).toBe('cars_comprehension');
    expect(cars('Reasoning Within the Text')).toBe('cars_within_text');
    expect(cars('Reasoning Beyond the Text')).toBe('cars_beyond_text');
  });

  test('returns null rather than guessing on an unknown shape', () => {
    expect(resolveCategoryId({ Section: 'Chemical', Content_Category_Code: '' })).toBeNull();
    expect(resolveCategoryId({ Section: 'Critical Analysis', Skill_Description: 'Unheard-of Skill' })).toBeNull();
  });
});

describe('toExamRow', () => {
  const base = {
    Question: '1',
    Section: 'Chemical and Physical Foundations of Biological Systems',
    Result: 'Incorrect',
    Time_Spent: '3 mins 3 secs',
    Difficulty: 'Easy',
    Flagged: 'Yes',
    Content_Category_Code: 'Content Category 5E',
  };

  test('maps a full row', () => {
    expect(toExamRow(base)).toEqual({
      question: 1,
      categoryId: '5E',
      correct: false,
      difficulty: 1,
      seconds: 183,
      flagged: true,
    });
  });

  test('collapses Expert onto the difficulty-3 cap', () => {
    expect(toExamRow({ ...base, Difficulty: 'Expert' })?.difficulty).toBe(3);
    expect(toExamRow({ ...base, Difficulty: 'Difficult' })?.difficulty).toBe(3);
    expect(toExamRow({ ...base, Difficulty: 'Moderate' })?.difficulty).toBe(2);
  });

  test('rejects rather than importing a row it cannot map', () => {
    expect(toExamRow({ ...base, Difficulty: 'Unknown' })).toBeNull();
    expect(toExamRow({ ...base, Content_Category_Code: '' })).toBeNull();
  });
});

describe('shrunkMastery', () => {
  test('pulls small samples toward 0.5 instead of the extremes', () => {
    // The whole point of the prior: one right answer is not mastery, four wrong is not zero.
    expect(shrunkMastery(1, 1)).toBeCloseTo(0.6);
    expect(shrunkMastery(0, 4)).toBeCloseTo(0.25);
    expect(shrunkMastery(4, 4)).toBeCloseTo(0.75);
  });

  test('an empty category sits exactly at 0.5', () => {
    expect(shrunkMastery(0, 0)).toBeCloseTo(0.5);
  });

  test('converges toward raw accuracy as evidence accumulates', () => {
    expect(shrunkMastery(90, 100)).toBeGreaterThan(0.85);
    expect(shrunkMastery(90, 100)).toBeLessThan(0.9);
  });

  test('rejects impossible input rather than emitting a nonsense mastery', () => {
    expect(() => shrunkMastery(5, 4)).toThrow();
    expect(() => shrunkMastery(-1, 4)).toThrow();
  });
});

describe('buildNote', () => {
  test('records provenance, timing and flag state', () => {
    expect(
      buildNote('AAMC-FL4', { question: 17, categoryId: '5E', correct: false, difficulty: 1, seconds: 183, flagged: true })
    ).toBe('AAMC-FL4 q17 | 183s | flagged');
  });

  test('omits absent detail', () => {
    expect(
      buildNote('AAMC-FL4', { question: 2, categoryId: '5E', correct: true, difficulty: 1, seconds: null, flagged: false })
    ).toBe('AAMC-FL4 q2');
  });
});

/**
 * Format-variant coverage. AAMC exports the same report in several shapes; each of these strings
 * is copied from a real file, and exam 5's 53 CARS questions were silently dropped until the
 * 'Skill: ' prefix rule existed.
 */
describe('resolveCategoryId across real AAMC format variants', () => {
  test('accepts both content-category code shapes', () => {
    const long = { Section: 'Chemical', Content_Category_Code: 'Content Category 5D' };
    const short = { Section: 'Chemical', Content_Category_Code: 'CC5D' };
    expect(resolveCategoryId(long)).toBe('5D');
    expect(resolveCategoryId(short)).toBe('5D');
  });

  test('accepts all three CARS skill-label shapes', () => {
    const cars = (skill: string) =>
      resolveCategoryId({ Section: 'Critical Analysis and Reasoning Skills', Skill_Description: skill });

    expect(cars('Reasoning Within the Text')).toBe('cars_within_text');
    expect(cars('Skill: Reasoning Within the Text')).toBe('cars_within_text');
    expect(cars('SIRS Skill 2: Reasoning Within the Text')).toBe('cars_within_text');
  });

  test('ignores the CARS content-category column entirely', () => {
    // Reports variously put 'CARS', a blank, or a discipline code (HUM/PSY/ECO/HIS) here.
    for (const code of ['CARS', '', 'HUM', 'PSY']) {
      expect(
        resolveCategoryId({
          Section: 'Critical Analysis and Reasoning Skills',
          Content_Category_Code: code,
          Skill_Description: 'Foundations of Comprehension',
        })
      ).toBe('cars_comprehension');
    }
  });

  test('does not mistake a discipline code for a content category', () => {
    expect(resolveCategoryId({ Section: 'Chemical', Content_Category_Code: 'PHY' })).toBeNull();
    expect(resolveCategoryId({ Section: 'Chemical', Content_Category_Code: 'CCXX' })).toBeNull();
  });
});
