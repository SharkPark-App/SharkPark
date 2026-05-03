import { runCronJob } from './_bootstrap';
import { EventsScrapersModule } from '../events/events-scrapers.module';
import { SportsEventsScraperService } from '../events/sports-events-scraper.service';

void runCronJob('fetch-sports-events', [EventsScrapersModule], async ({ app }) => {
  const scraper = app.get(SportsEventsScraperService);
  await scraper.scrapeAll();
});
