jest.mock('./_bootstrap', () => ({ runCronJob: jest.fn() }));

import { runCronJob } from './_bootstrap';
import { EventsScrapersModule } from '../events/events-scrapers.module';
import { EventsScraperService } from '../events/events-scraper.service';
import './fetch-events';

type WorkFn = (ctx: { app: unknown }) => Promise<void>;

describe('fetch-events cron', () => {
  const call = (runCronJob as jest.Mock).mock.calls[0];

  it('registers under fetch-events with [EventsScrapersModule]', () => {
    expect(call[0]).toBe('fetch-events');
    expect(call[1]).toEqual([EventsScrapersModule]);
  });

  it('resolves EventsScraperService and invokes scrapeAll()', async () => {
    const work = call[2] as WorkFn;
    const scraper = { scrapeAll: jest.fn().mockResolvedValue(undefined) };
    const app = { get: jest.fn().mockReturnValue(scraper) };

    await work({ app });

    expect(app.get).toHaveBeenCalledWith(EventsScraperService);
    expect(scraper.scrapeAll).toHaveBeenCalledTimes(1);
  });
});
