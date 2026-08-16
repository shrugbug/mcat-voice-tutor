import { describe, expect, test } from 'vitest';
import { formatIssues, parseIssues } from '../lib/sentry-issues';
import { fetchSentryIssues } from '../scripts/fetch-sentry';

const FIXTURE = [
  { id: '1', title: 'TypeError: x is not a function', count: '14', culprit: 'app/page.tsx' },
  { id: '2', title: 'Failed to fetch', count: '3', culprit: 'lib/realtime-client.ts' },
];

describe('parseIssues', () => {
  test('parses the issues payload, coercing the string count', () => {
    expect(parseIssues(FIXTURE)).toEqual([
      { id: '1', title: 'TypeError: x is not a function', count: 14, culprit: 'app/page.tsx' },
      { id: '2', title: 'Failed to fetch', count: 3, culprit: 'lib/realtime-client.ts' },
    ]);
  });

  test('returns an empty list for a non-array payload rather than throwing', () => {
    expect(parseIssues({ detail: 'Invalid token' })).toEqual([]);
    expect(parseIssues(null)).toEqual([]);
  });

  test('skips malformed entries instead of failing the whole fetch', () => {
    expect(parseIssues([{ id: '1' }, FIXTURE[0]])).toHaveLength(1);
  });
});

describe('formatIssues', () => {
  test('null means Sentry was unavailable, which must be said out loud', () => {
    // A Sentry outage must not silently look like "no errors".
    expect(formatIssues(null)).toBe('(Sentry unavailable)');
  });

  test('empty means genuinely no issues', () => {
    expect(formatIssues([])).toBe('(no unresolved Sentry issues in the last 24h)');
  });

  test('renders one line per issue, most frequent first', () => {
    expect(formatIssues(parseIssues(FIXTURE))).toBe(
      '- TypeError: x is not a function (14x, app/page.tsx)\n- Failed to fetch (3x, lib/realtime-client.ts)'
    );
  });
});

describe('fetchSentryIssues', () => {
  test('returns unavailable without making a request when credentials are missing', async () => {
    const previous = {
      token: process.env.SENTRY_AUTH_TOKEN,
      org: process.env.SENTRY_ORG,
      project: process.env.SENTRY_PROJECT,
    };
    delete process.env.SENTRY_AUTH_TOKEN;
    delete process.env.SENTRY_ORG;
    delete process.env.SENTRY_PROJECT;

    try {
      await expect(fetchSentryIssues()).resolves.toBeNull();
    } finally {
      if (previous.token === undefined) delete process.env.SENTRY_AUTH_TOKEN;
      else process.env.SENTRY_AUTH_TOKEN = previous.token;
      if (previous.org === undefined) delete process.env.SENTRY_ORG;
      else process.env.SENTRY_ORG = previous.org;
      if (previous.project === undefined) delete process.env.SENTRY_PROJECT;
      else process.env.SENTRY_PROJECT = previous.project;
    }
  });
});
