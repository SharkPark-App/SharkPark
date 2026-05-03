jest.mock('./_bootstrap', () => ({ runCronJob: jest.fn() }));

import { runCronJob } from './_bootstrap';
import { EventsScrapersModule } from '../events/events-scrapers.module';
import { SportsEventsScraperService } from '../events/sports-events-scraper.service';
import './fetch-sports-events';

type WorkFn = (ctx: { app: unknown }) => Promise<void>;

describe('fetch-sports-events cron', () => {
  const call = (runCronJob as jest.Mock).mock.calls[0];

  it('registers under fetch-sports-events with [EventsScrapersModule]', () => {
    expect(call[0]).toBe('fetch-sports-events');
    expect(call[1]).toEqual([EventsScrapersModule]);
  });

  it('resolves SportsEventsScraperService and invokes scrapeAll()', async () => {
    const work = call[2] as WorkFn;
    const scraper = { scrapeAll: jest.fn().mockResolvedValue(undefined) };
    const app = { get: jest.fn().mockReturnValue(scraper) };

    await work({ app });

    expect(app.get).toHaveBeenCalledWith(SportsEventsScraperService);
    expect(scraper.scrapeAll).toHaveBeenCalledTimes(1);
  });
});
