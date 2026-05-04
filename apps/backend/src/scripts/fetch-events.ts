import { runCronJob } from './_bootstrap';
import { EventsScrapersModule } from '../events/events-scrapers.module';
import { EventsScraperService } from '../events/events-scraper.service';

void runCronJob('fetch-events', [EventsScrapersModule], async ({ app }) => {
  const scraper = app.get(EventsScraperService);
  await scraper.scrapeAll();
});
