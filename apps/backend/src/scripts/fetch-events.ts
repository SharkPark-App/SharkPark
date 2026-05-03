import { runCronJob } from './_bootstrap';
import { EventsModule } from '../events/events.module';
import { EventsScraperService } from '../events/events-scraper.service';

void runCronJob('fetch-events', [EventsModule], async ({ app }) => {
  const scraper = app.get(EventsScraperService);
  await scraper.scrapeAll();
});
