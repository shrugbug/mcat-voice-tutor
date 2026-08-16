import { describe, expect, test } from 'vitest';
import { buildWriteBackPlan, buildUpdateSql } from '../scripts/push-feedback-status';

describe('buildWriteBackPlan', () => {
  test('groups original ids by source database', () => {
    expect(
      buildWriteBackPlan([
        { source: 'prod', orig_id: 1 },
        { source: 'prod', orig_id: 4 },
        { source: 'demo', orig_id: 2 },
      ])
    ).toEqual({ prod: [1, 4], demo: [2] });
  });

  test('ignores rows with no source (local db)', () => {
    expect(buildWriteBackPlan([{ source: null as unknown as string, orig_id: 9 }])).toEqual({});
  });
});

describe('buildUpdateSql', () => {
  test('touches only the status column, and only the given ids', () => {
    const sql = buildUpdateSql([1, 4]);
    expect(sql).toBe("UPDATE feedback SET status='proposed' WHERE id IN (1,4) AND status='new'");
  });

  test('rejects non-integer ids rather than interpolating them', () => {
    expect(() => buildUpdateSql([1, 2.5])).toThrow();
    expect(() => buildUpdateSql(['1); DROP TABLE feedback;--' as unknown as number])).toThrow();
  });

  test('returns empty string for no ids', () => {
    expect(buildUpdateSql([])).toBe('');
  });
});
