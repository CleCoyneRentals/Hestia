import * as Sentry from '@sentry/node';
import { env } from '../config.js';

export function initSentry() {
  if (!env.SENTRY_DSN) {
    console.warn('SENTRY_DSN not set — error tracking disabled');
    return;
  }

  Sentry.init({
    dsn: env.SENTRY_DSN,
    environment: env.NODE_ENV,
    tracesSampleRate: env.NODE_ENV === 'production' ? 0.1 : 1.0,
  });
}

export { Sentry };
