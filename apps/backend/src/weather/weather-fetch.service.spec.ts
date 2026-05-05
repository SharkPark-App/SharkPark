import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WeatherFetchService } from './weather-fetch.service';
import { PrismaService } from '../database/database.module';
import { NwsClient, NwsHourlyPeriod } from './nws.client';

const buildPeriod = (
  overrides: Partial<NwsHourlyPeriod> = {},
): NwsHourlyPeriod => ({
  startTime: '2026-05-03T12:00:00-07:00',
  endTime: '2026-05-03T13:00:00-07:00',
  temperature: 72,
  temperatureUnit: 'F',
  probabilityOfPrecipitation: { unitCode: 'wmoUnit:percent', value: 20 },
  shortForecast: 'Mostly Sunny',
  windSpeed: '5 to 10 mph',
  relativeHumidity: { unitCode: 'wmoUnit:percent', value: 55 },
  isDaytime: true,
  ...overrides,
});

describe('WeatherFetchService', () => {
  let service: WeatherFetchService;
  let prisma: { weather: { create: jest.Mock }; school: { findFirst: jest.Mock } };
  let nws: { getHourlyForecast: jest.Mock };

  beforeEach(async () => {
    prisma = {
      weather: { create: jest.fn().mockResolvedValue({}) },
      school: { findFirst: jest.fn().mockResolvedValue({ id: 'school-1' }) },
    };
    nws = { getHourlyForecast: jest.fn() };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WeatherFetchService,
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

    service = module.get(WeatherFetchService);
  });

  it('writes a weather row from the first hourly period', async () => {
    nws.getHourlyForecast.mockResolvedValue({
      updateTime: '2026-05-03T18:00:00Z',
      periods: [
        buildPeriod({
          temperature: 75,
          shortForecast: 'Light Rain Likely',
          probabilityOfPrecipitation: {
            unitCode: 'wmoUnit:percent',
            value: 70,
          },
          windSpeed: '5 to 10 mph',
          relativeHumidity: { unitCode: 'wmoUnit:percent', value: 60 },
        }),
      ],
    });

    await service.fetchWeather();

    expect(prisma.weather.create).toHaveBeenCalledTimes(1);
    const data = prisma.weather.create.mock.calls[0][0].data;
    expect(data.school_id).toBe('school-1');
    expect(data.temperature_f).toBe(75);
    expect(data.precipitation_probability).toBeCloseTo(0.7);
    expect(data.is_raining).toBe(true);
    expect(data.wind_speed_mph).toBe(10);
    expect(data.humidity_percent).toBe(60);
    expect(data.conditions).toBe('light rain likely');
  });

  it('normalizes pop=50% to 0.5 and treats <50% rain text as not raining', async () => {
    nws.getHourlyForecast.mockResolvedValue({
      updateTime: '2026-05-03T18:00:00Z',
      periods: [
        buildPeriod({
          shortForecast: 'Slight Chance Rain Showers',
          probabilityOfPrecipitation: {
            unitCode: 'wmoUnit:percent',
            value: 30,
          },
        }),
      ],
    });

    await service.fetchWeather();
    const data = prisma.weather.create.mock.calls[0][0].data;
    expect(data.precipitation_probability).toBeCloseTo(0.3);
    expect(data.is_raining).toBe(false);
  });

  it('logs and exits when NWS returns no periods', async () => {
    nws.getHourlyForecast.mockResolvedValue({
      updateTime: '2026-05-03T18:00:00Z',
      periods: [],
    });

    await service.fetchWeather();
    expect(prisma.weather.create).not.toHaveBeenCalled();
  });

  it('swallows NWS errors instead of throwing (cron-safe)', async () => {
    nws.getHourlyForecast.mockRejectedValue(new Error('502 Bad Gateway'));
    await expect(service.fetchWeather()).resolves.toBeUndefined();
    expect(prisma.weather.create).not.toHaveBeenCalled();
  });

  it('treats null pop value as zero', async () => {
    nws.getHourlyForecast.mockResolvedValue({
      updateTime: '2026-05-03T18:00:00Z',
      periods: [
        buildPeriod({
          probabilityOfPrecipitation: {
            unitCode: 'wmoUnit:percent',
            value: null,
          },
        }),
      ],
    });
    await service.fetchWeather();
    const data = prisma.weather.create.mock.calls[0][0].data;
    expect(data.precipitation_probability).toBe(0);
    expect(data.is_raining).toBe(false);
  });

  it('logs and exits when no school record is found', async () => {
    prisma.school.findFirst.mockResolvedValue(null);
    nws.getHourlyForecast.mockResolvedValue({
      updateTime: '2026-05-03T18:00:00Z',
      periods: [buildPeriod()],
    });
    await service.fetchWeather();
    expect(prisma.weather.create).not.toHaveBeenCalled();
  });

  it('converts Celsius temperatures to Fahrenheit defensively', async () => {
    nws.getHourlyForecast.mockResolvedValue({
      updateTime: '2026-05-03T18:00:00Z',
      periods: [
        buildPeriod({ temperature: 20, temperatureUnit: 'C' }),
      ],
    });
    await service.fetchWeather();
    const data = prisma.weather.create.mock.calls[0][0].data;
    expect(data.temperature_f).toBeCloseTo(68);
  });
});
