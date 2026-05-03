import { Module } from '@nestjs/common';
import { EventsScraperService } from './events-scraper.service';

/**
 * Lightweight module exposing only the campus-event scraper services.
 *
 * Use this from cron scripts (`fetch-events.ts`) so they don't pull in
 * `EventsController` (Fastify route registration) or `EventsService` (only
 * needed by the HTTP read path) — keeps the per-script Nest bootstrap small,
 * matching the pattern established by `ShuttleTrackerCoreModule` in #176.
 *
 * The full {@link EventsModule} re-exports this so HTTP consumers (and any
 * future code that needs both the read service and a scraper handle) still
 * get the same singleton via DI.
 *
 * Future scrapers (e.g. a sports-events scraper hosted on a separate site)
 * should be added here so `fetch-events.ts` can run them in the same cron.
 */
@Module({
  providers: [EventsScraperService],
  exports: [EventsScraperService],
})
export class EventsScrapersModule {}
