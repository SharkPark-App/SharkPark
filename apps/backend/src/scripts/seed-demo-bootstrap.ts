/**
 * Demo seed bootstrap.
 *
 * One-shot script that fills the *dynamic* tables prisma/seed.ts can't:
 *   - `weather`            — current observation from NWS api.weather.gov
 *   - `weather_forecasts`  — 156h hourly forecast from NWS
 *   - `campus_events`      — real upcoming CSULB events from CampusLabs
 *
 * Run AFTER `pnpm db:seed` (which populates lots/users/buildings/etc.) and
 * BEFORE the Python ML prediction scripts (which read these tables).
 *
 * Usage (from `apps/backend`):
 *   pnpm exec ts-node --project tsconfig.scripts.json \
 *     --compiler-options '{"module":"CommonJS"}' \
 *     src/scripts/seed-demo-bootstrap.ts
 *
 * Or via the helper script:  scripts/seed-demo.sh
 *
 * Standalone — boots a minimal NestApplicationContext (no HTTP server,
 * no schedulers, no Sentry) so the existing services can be reused
 * verbatim instead of reimplementing the NWS / CampusLabs scrape logic.
 */
import 'dotenv/config';

import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';

import { DatabaseModule } from '../database/database.module';
import {
  appConfig,
  authConfig,
  dbConfig,
  privacyConfig,
  weatherConfig,
  notificationsConfig,
  validateConfig,
} from '../config/configuration';
import { WeatherFetchService } from '../weather/weather-fetch.service';
import { WeatherForecastFetchService } from '../weather/weather-forecast-fetch.service';
import { NwsClient } from '../weather/nws.client';
import { EventsScraperService } from '../events/events-scraper.service';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [
        appConfig,
        authConfig,
        dbConfig,
        privacyConfig,
        weatherConfig,
        notificationsConfig,
      ],
      validate: validateConfig,
    }),
    DatabaseModule,
  ],
  providers: [
    NwsClient,
    WeatherFetchService,
    WeatherForecastFetchService,
    EventsScraperService,
  ],
})
class DemoBootstrapModule {}

async function runStep(name: string, fn: () => Promise<void>): Promise<void> {
  const t0 = Date.now();
  process.stdout.write(`[demo-bootstrap] ${name}... `);
  try {
    await fn();
    console.log(`OK (${Date.now() - t0} ms)`);
  } catch (err) {
    console.log('FAILED');
    console.error(`[demo-bootstrap] ${name} error:`, err);
    throw err;
  }
}

/**
 * Refuse to run if DATABASE_URL points anywhere that could plausibly be
 * production. Demo seeding writes weather observations, forecasts, and
 * scraped campus events — running it against prod would pollute the
 * audit trail at best, and overwrite live data at worst.
 */
function assertNonProductionDatabase(): void {
  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      '[demo-bootstrap] FATAL: NODE_ENV=production — refusing to run demo seed.',
    );
  }
  const dbUrl = process.env.DATABASE_URL ?? '';
  if (!dbUrl) {
    throw new Error(
      '[demo-bootstrap] FATAL: DATABASE_URL is not set. Refusing to run.',
    );
  }
  // Block any host that smells like a managed/remote DB. Local Postgres
  // (localhost / 127.0.0.1 / Docker host) is the only intended target.
  const prodPatterns = [
    /neon\.tech/i,
    /fly\.dev/i,
    /supabase\./i,
    /amazonaws\.com/i,
    /azure\.com/i,
    /\bprod(?:uction)?\b/i,
  ];
  for (const pattern of prodPatterns) {
    if (pattern.test(dbUrl)) {
      const safeUrl = dbUrl.replace(/:[^:@/]+@/, ':***@');
      throw new Error(
        `[demo-bootstrap] FATAL: DATABASE_URL matches production pattern ${pattern} (${safeUrl}). Refusing to run.`,
      );
    }
  }
  const allowLocal =
    /localhost|127\.0\.0\.1|host\.docker\.internal|::1/i.test(dbUrl);
  if (!allowLocal) {
    const safeUrl = dbUrl.replace(/:[^:@/]+@/, ':***@');
    throw new Error(
      `[demo-bootstrap] FATAL: DATABASE_URL host is not local (${safeUrl}). Refusing to run. Set DATABASE_URL to a local Postgres or run via scripts/seed-demo.sh.`,
    );
  }
}

async function main(): Promise<void> {
  assertNonProductionDatabase();

  const app = await NestFactory.createApplicationContext(DemoBootstrapModule, {
    logger: ['log', 'warn', 'error'],
  });
  app.enableShutdownHooks();

  const weather = app.get(WeatherFetchService);
  const forecast = app.get(WeatherForecastFetchService);
  const events = app.get(EventsScraperService);

  try {
    // Order matters only loosely — they're independent. Run sequentially so
    // failures surface cleanly with one stack trace per service.
    await runStep('fetch current weather (NWS)', () => weather.fetchWeather());
    await runStep('fetch 156h weather forecast (NWS)', () =>
      forecast.fetchForecast(),
    );
    await runStep('scrape upcoming campus events (CampusLabs)', () =>
      events.scrapeAll(),
    );

    console.log('\n[demo-bootstrap] Done. Next: run ML prediction scripts.');
  } finally {
    await app.close();
  }
}

main().catch((err) => {
  console.error('[demo-bootstrap] fatal:', err);
  process.exit(1);
});
