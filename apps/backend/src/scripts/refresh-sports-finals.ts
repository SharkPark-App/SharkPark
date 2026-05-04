import { runCronJob } from './_bootstrap';
import { EventsScrapersModule } from '../events/events-scrapers.module';
import { SportsEventsScraperService } from '../events/sports-events-scraper.service';

// Periodic FINAL-score refresh — runs every 30 min and short-circuits when
// no SCHEDULED games sit inside the recent lookback window, so it makes
// zero outbound API calls on quiet days. See
// SportsEventsScraperService.refreshFinalScores for the DB probe + flip logic.
//
// We don't model a LIVE state for sports events: the Sidearm calendar API
// has no in-progress signal. This cron only flips SCHEDULED → FINAL once the
// box score is published.
void runCronJob('refresh-sports-finals', [EventsScrapersModule], async ({ app }) => {
  const scraper = app.get(SportsEventsScraperService);
  await scraper.refreshFinalScores();
});
