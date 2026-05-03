jest.mock('./_bootstrap', () => ({ runCronJob: jest.fn() }));

import { runCronJob } from './_bootstrap';
import { WeatherModule } from '../weather/weather.module';
import './fetch-weather';

type WorkFn = (ctx: { app: unknown }) => Promise<void>;

describe('fetch-weather cron', () => {
  const call = (runCronJob as jest.Mock).mock.calls[0];

  it('registers as fetch-weather with [WeatherModule]', () => {
    expect(call[0]).toBe('fetch-weather');
    expect(call[1]).toEqual([WeatherModule]);
  });

  it('calls WeatherFetchService.fetchWeather()', async () => {
    const work = call[2] as WorkFn;
    const svc = { fetchWeather: jest.fn().mockResolvedValue(undefined) };
    const app = { get: jest.fn().mockReturnValue(svc) };

    await work({ app });

    expect(svc.fetchWeather).toHaveBeenCalledTimes(1);
  });
});
