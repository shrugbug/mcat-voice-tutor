/**
 * Privacy posture for this app.
 *
 * There is no account system: prod is a single student behind basic auth, demo is anonymous and
 * public. No user identity is ever sent. Student content can appear in many Sentry fields (request
 * body, breadcrumbs, contexts, extra, etc.), so we ship an allowlist: only explicitly safe fields
 * are forwarded. Everything else is dropped.
 */
export interface ScrubbableEvent {
  event_id?: string;
  timestamp?: number;
  level?: string;
  platform?: string;
  environment?: string;
  release?: string;
  tags?: Record<string, unknown>;
  exception?: {
    values?: Array<Partial<{ type: string; value: string }>>;
  };
  request?: { url?: string; data?: unknown; body?: unknown };
  user?: unknown;
  breadcrumbs?: unknown[];
  contexts?: Record<string, unknown>;
  extra?: Record<string, unknown>;
}

/**
 * Allowlist of Sentry event fields. Student content is stripped from request bodies, user
 * identity, breadcrumbs, contexts, and extra. We keep only safe metadata and the bare exception
 * type/value (which the app already sanitizes before reaching Sentry).
 */
export function scrubEvent<T extends ScrubbableEvent>(event: T): T {
  const allowed: ScrubbableEvent = {};

  if (event.event_id) allowed.event_id = event.event_id;
  if (event.timestamp) allowed.timestamp = event.timestamp;
  if (event.level) allowed.level = event.level;
  if (event.platform) allowed.platform = event.platform;
  if (event.environment) allowed.environment = event.environment;
  if (event.release) allowed.release = event.release;
  if (event.tags) allowed.tags = event.tags;

  if (event.exception?.values) {
    allowed.exception = {
      values: event.exception.values.map((value) => ({
        type: value.type,
        value: value.value,
      })),
    };
  }

  if (event.request?.url) {
    allowed.request = { url: event.request.url };
  }

  return allowed as T;
}
