import { runCronJob } from './_bootstrap';
import { EventsScraperService } from '../events/events-scraper.service';

void runCronJob('fetch-events', async ({ app }) => {
  const scraper = app.get(EventsScraperService);
  await scraper.scrapeAll();
});
