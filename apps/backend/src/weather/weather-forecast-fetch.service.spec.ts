import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WeatherForecastFetchService } from './weather-forecast-fetch.service';
import { PrismaService } from '../database/database.module';
import { NwsClient, NwsHourlyPeriod } from './nws.client';

const buildPeriod = (
  startTime: string,
  overrides: Partial<NwsHourlyPeriod> = {},
): NwsHourlyPeriod => ({
  startTime,
  endTime: startTime,
  temperature: 70,
  temperatureUnit: 'F',
  probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: 10 },
  shortForecast: 'Sunny',
  windSpeed: '5 mph',
  isDaytime: true,
  ...overrides,
});

describe('WeatherForecastFetchService', () => {
  let service: WeatherForecastFetchService;
  let prisma: {
    weatherForecast: { upsert: jest.Mock; deleteMany: jest.Mock };
    school: { findFirst: jest.Mock };
  };
  let nws: { getHourlyForecast: jest.Mock };

  beforeEach(async () => {
    prisma = {
      weatherForecast: {
        upsert: jest.fn().mockResolvedValue({}),
        deleteMany: jest.fn().mockResolvedValue({ count: 0 }),
      },
      school: { findFirst: jest.fn().mockResolvedValue({ id: 'school-1' }) },
    };
    nws = { getHourlyForecast: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WeatherForecastFetchService,
        { provide: PrismaService, useValue: prisma },
        {
          provide: ConfigService,
          useValue: {
            get: (key: string, fallback: unknown) => {
              const map: Record<string, unknown> = {
                'weather.latitude': 33.7838,
                'weather.longitude': -118.1134,
              };
              return map[key] ?? fallback;
            },
          },
        },
        { provide: NwsClient, useValue: nws },
      ],
    }).compile();

    service = module.get(WeatherForecastFetchService);
  });

  it('upserts every hourly period keyed by (school_id, target_time)', async () => {
    nws.getHourlyForecast.mockResolvedValue({
      updateTime: '2026-05-03T18:00:00Z',
      periods: [
        buildPeriod('2026-05-03T12:00:00-07:00'),
        buildPeriod('2026-05-03T13:00:00-07:00', {
          shortForecast: 'Light Rain Likely',
          probabilityOfPrecipitation: {
            unitCode: 'wmoUnit:percent',
            value: 60,
          },
        }),
      ],
    });

    await service.fetchForecast();

    expect(prisma.weatherForecast.upsert).toHaveBeenCalledTimes(2);
    const firstCall = prisma.weatherForecast.upsert.mock.calls[0][0];
    expect(firstCall.where).toEqual({
      school_id_target_time: {
        school_id: 'school-1',
        target_time: new Date('2026-05-03T12:00:00-07:00'),
      },
    });
    expect(firstCall.create.school_id).toBe('school-1');
    expect(firstCall.create.precipitation_probability).toBeCloseTo(0.1);
    expect(firstCall.create.is_raining).toBe(false);

    const secondCall = prisma.weatherForecast.upsert.mock.calls[1][0];
    expect(secondCall.create.is_raining).toBe(true);
    expect(secondCall.create.precipitation_probability).toBeCloseTo(0.6);
  });

  it('exits early on empty period array', async () => {
    nws.getHourlyForecast.mockResolvedValue({
      updateTime: '2026-05-03T18:00:00Z',
      periods: [],
    });
    await service.fetchForecast();
    expect(prisma.weatherForecast.upsert).not.toHaveBeenCalled();
  });

  it('swallows NWS errors (cron-safe)', async () => {
    nws.getHourlyForecast.mockRejectedValue(new Error('boom'));
    await expect(service.fetchForecast()).resolves.toBeUndefined();
    expect(prisma.weatherForecast.upsert).not.toHaveBeenCalled();
  });
});
