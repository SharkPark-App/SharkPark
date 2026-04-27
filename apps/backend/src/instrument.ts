// MUST be imported FIRST in main.ts (before any other application module).
// See https://docs.sentry.io/platforms/javascript/guides/nestjs/
import * as Sentry from '@sentry/nestjs';

const dsn = process.env.SENTRY_DSN;

if (dsn) {
  Sentry.init({
    dsn,
    environment: process.env.SENTRY_ENVIRONMENT ?? process.env.NODE_ENV ?? 'development',
    release: process.env.SENTRY_RELEASE,
    // Conservative defaults for free tier — bump once we have traffic data.
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 0,
    // Drop noisy framework breadcrumbs we don't need
    sendDefaultPii: false,
    // Ignore common health-check noise
    ignoreTransactions: ['GET /api/v1/health', 'GET /api/v1/health/live', 'GET /api/v1/health/ready'],
  });
}
