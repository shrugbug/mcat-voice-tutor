import * as Sentry from '@sentry/nextjs';
import { scrubEvent, type ScrubbableEvent } from './lib/sentry-scrub';

export function register() {
  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    enabled: Boolean(process.env.SENTRY_DSN),
    sendDefaultPii: false,
    tracesSampleRate: 0,
    beforeSend: (event) => scrubEvent(event as ScrubbableEvent) as typeof event,
  });

  Sentry.setTag('instance', process.env.MCAT_INSTANCE ?? 'prod');
}

export const onRequestError = Sentry.captureRequestError;
