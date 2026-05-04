import { runCronJob } from './_bootstrap';
import { EventsScrapersModule } from '../events/events-scrapers.module';
import { SportsEventsScraperService } from '../events/sports-events-scraper.service';

// Live-window sports refresh — runs frequently (every 2 min) and short-circuits
// when no candidate events are in the live window. See
// SportsEventsScraperService.scrapeLive for the DB probe + skip logic that
// keeps this from hammering Sidearm outside game days.
void runCronJob('fetch-sports-events-live', [EventsScrapersModule], async ({ app }) => {
  const scraper = app.get(SportsEventsScraperService);
  await scraper.scrapeLive();
});
