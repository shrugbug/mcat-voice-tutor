import { parseIssues, type SentryIssue } from '../lib/sentry-issues';

/**
 * Returns null on ANY failure -- missing token, network error, non-200. The caller renders that
 * as "(Sentry unavailable)" and continues: this must never fail the nightly run, because the
 * tune sentinel gates on success and a Sentry outage staling the freshness monitor would be a
 * false alarm about the tuner.
 */
export async function fetchSentryIssues(): Promise<SentryIssue[] | null> {
  const token = process.env.SENTRY_AUTH_TOKEN;
  const org = process.env.SENTRY_ORG;
  const project = process.env.SENTRY_PROJECT;
  if (!token || !org || !project) return null;

  const url = `https://sentry.io/api/0/projects/${org}/${project}/issues/?query=is:unresolved&statsPeriod=24h`;

  try {
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) return null;
    return parseIssues(await response.json());
  } catch {
    return null;
  }
}
