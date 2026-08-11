import { describe, expect, test } from 'vitest';
import { scrubEvent } from '../lib/sentry-scrub';

const SENTINEL = 'STUDENT_REASONING_42';

describe('scrubEvent', () => {
  test('strips the request body and request data', () => {
    const event = {
      request: {
        data: { name: 'record_episode', args: { studentReasoning: 'I guessed' } },
        body: { name: 'record_episode', args: { studentReasoning: 'I guessed' } },
        url: '/api/tool',
      },
    };
    const scrubbed = scrubEvent(event);
    expect(scrubbed.request?.data).toBeUndefined();
    expect(scrubbed.request?.body).toBeUndefined();
    expect(JSON.stringify(scrubbed)).not.toContain('guessed');
  });

  test('keeps the url, which carries no student content', () => {
    expect(scrubEvent({ request: { data: { a: 1 }, url: '/api/tool' } }).request?.url).toBe('/api/tool');
  });

  test('never attaches a user identity', () => {
    expect(scrubEvent({ user: { id: 'aryan', email: 'a@example.com' } }).user).toBeUndefined();
  });

  test('is a no-op on an event with neither field', () => {
    expect(scrubEvent({})).toEqual({});
  });

  test('strips every source of student content while preserving safe fields', () => {
    const event = {
      event_id: 'abc',
      timestamp: 1234567890,
      level: 'error',
      platform: 'node',
      environment: 'test',
      release: '1.0.0',
      tags: { instance: 'demo' },
      exception: {
        values: [{ type: 'Error', value: 'safe error message' }],
      },
      request: {
        url: '/api/tool',
        data: { studentReasoning: SENTINEL },
        body: { studentReasoning: SENTINEL },
        headers: { authorization: SENTINEL },
        query_string: `reasoning=${SENTINEL}`,
      },
      user: { id: SENTINEL },
      breadcrumbs: [{ message: 'before', data: { studentReasoning: SENTINEL } }],
      contexts: {
        tool: { args: { studentReasoning: SENTINEL } },
        app: { name: 'mcat' },
      },
      extra: { requestBody: { studentReasoning: SENTINEL } },
    };

    const scrubbed = scrubEvent(event);

    expect(JSON.stringify(scrubbed)).not.toContain(SENTINEL);
    expect(scrubbed.tags?.instance).toBe('demo');
    expect(scrubbed.request?.url).toBe('/api/tool');
    expect(scrubbed.exception?.values?.[0].type).toBe('Error');
    expect(scrubbed.exception?.values?.[0].value).toBe('safe error message');
    expect(scrubbed.breadcrumbs).toBeUndefined();
    expect(scrubbed.contexts).toBeUndefined();
    expect(scrubbed.extra).toBeUndefined();
    expect(scrubbed.user).toBeUndefined();
    expect(scrubbed.request?.data).toBeUndefined();
    expect(scrubbed.request?.body).toBeUndefined();
  });
});
