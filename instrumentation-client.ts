import * as Sentry from '@sentry/nextjs';
import { scrubEvent, type ScrubbableEvent } from './lib/sentry-scrub';

Sentry.init({
  // NEXT_PUBLIC_ is required for the client: Next.js inlines it at build time.
  dsn: process.env.NEXT_PUBLIC_SENTRY_DSN,
  enabled: Boolean(process.env.NEXT_PUBLIC_SENTRY_DSN),
  sendDefaultPii: false,
  tracesSampleRate: 0,
  beforeSend: (event) => scrubEvent(event as ScrubbableEvent) as typeof event,
});

Sentry.setTag(
  'instance',
  typeof window !== 'undefined' && window.location.hostname.startsWith('mcatdemo') ? 'demo' : 'prod'
);
