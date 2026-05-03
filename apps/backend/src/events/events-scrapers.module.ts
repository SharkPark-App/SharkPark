import { Module } from '@nestjs/common';
import { EventsScraperService } from './events-scraper.service';
import { SportsEventsScraperService } from './sports-events-scraper.service';

/**
 * Lightweight module exposing only the campus-event scraper services.
 *
 * Use this from cron scripts (`fetch-events.ts`, `fetch-sports-events.ts`)
 * so they don't pull in `EventsController` (Fastify route registration) or
 * `EventsService` (only needed by the HTTP read path) — keeps the per-script
 * Nest bootstrap small, matching the pattern established by
 * `ShuttleTrackerCoreModule` in #176.
 *
 * The full {@link EventsModule} re-exports this so HTTP consumers (and any
 * future code that needs both the read service and a scraper handle) still
 * get the same singleton via DI.
 */
@Module({
  providers: [EventsScraperService, SportsEventsScraperService],
  exports: [EventsScraperService, SportsEventsScraperService],
})
export class EventsScrapersModule {}
