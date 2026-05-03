jest.mock('./_bootstrap', () => ({ runCronJob: jest.fn() }));

import { runCronJob } from './_bootstrap';
import { WeatherModule } from '../weather/weather.module';
import './fetch-weather-forecast';

type WorkFn = (ctx: { app: unknown }) => Promise<void>;

describe('fetch-weather-forecast cron', () => {
  const call = (runCronJob as jest.Mock).mock.calls[0];

  it('registers as fetch-weather-forecast with [WeatherModule]', () => {
    expect(call[0]).toBe('fetch-weather-forecast');
    expect(call[1]).toEqual([WeatherModule]);
  });

  it('calls WeatherForecastFetchService.fetchForecast()', async () => {
    const work = call[2] as WorkFn;
    const svc = { fetchForecast: jest.fn().mockResolvedValue(undefined) };
    const app = { get: jest.fn().mockReturnValue(svc) };

    await work({ app });

    expect(svc.fetchForecast).toHaveBeenCalledTimes(1);
  });
});
