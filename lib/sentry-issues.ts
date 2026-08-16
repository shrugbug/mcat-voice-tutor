export interface SentryIssue {
  id: string;
  title: string;
  count: number;
  culprit: string;
}

export function parseIssues(payload: unknown): SentryIssue[] {
  if (!Array.isArray(payload)) return [];

  return payload.flatMap((raw): SentryIssue[] => {
    if (raw === null || typeof raw !== 'object') return [];
    const r = raw as Record<string, unknown>;
    if (typeof r.id !== 'string' || typeof r.title !== 'string') return [];
    return [
      {
        id: r.id,
        title: r.title,
        count: Number(r.count ?? 0),
        culprit: typeof r.culprit === 'string' ? r.culprit : '',
      },
    ];
  });
}

/**
 * null means the fetch failed. That must read differently from an empty list: a Sentry outage
 * silently rendering as "no errors" is exactly the failure the sentinel discipline exists to
 * prevent.
 */
export function formatIssues(issues: SentryIssue[] | null): string {
  if (issues === null) return '(Sentry unavailable)';
  if (issues.length === 0) return '(no unresolved Sentry issues in the last 24h)';

  return [...issues]
    .sort((a, b) => b.count - a.count)
    .map((i) => `- ${i.title} (${i.count}x${i.culprit ? `, ${i.culprit}` : ''})`)
    .join('\n');
}
