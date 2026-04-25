import { Test, TestingModule } from '@nestjs/testing';
import { ConfigService } from '@nestjs/config';
import { WeatherFetchService } from './weather-fetch.service';
import { PrismaService } from '../database/database.module';

// Mock global fetch
const mockFetch = jest.fn();
globalThis.fetch = mockFetch;

describe('WeatherFetchService', () => {
  let service: WeatherFetchService;
  let prisma: {
    school: { findFirst: jest.Mock };
    weather: { create: jest.Mock };
  };
  let configGet: jest.Mock;

  const mockWeatherResponse = {
    weather: [{ main: 'Clear', description: 'clear sky' }],
    main: { temp: 72, feels_like: 70, humidity: 45 },
    wind: { speed: 5 },
    pop: 0,
  };

  const mockSchool = { id: 'school-1' };

  beforeEach(async () => {
    prisma = {
      school: { findFirst: jest.fn() },
      weather: { create: jest.fn() },
    };

    configGet = jest.fn((key: string, defaultVal?: unknown) => {
      const map: Record<string, unknown> = {
        'weather.openWeatherApiKey': 'test-api-key',
        'weather.latitude': 33.7838,
        'weather.longitude': -118.1134,
      };
      return map[key] ?? defaultVal;
    });

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WeatherFetchService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();

    service = module.get<WeatherFetchService>(WeatherFetchService);
    jest.clearAllMocks();
  });

  it('should skip fetch when API key is not set', async () => {
    // Create a service with no API key
    configGet.mockImplementation((key: string, defaultVal?: unknown) => {
      if (key === 'weather.openWeatherApiKey') return '';
      return defaultVal;
    });

    const module = await Test.createTestingModule({
      providers: [
        WeatherFetchService,
        { provide: PrismaService, useValue: prisma },
        { provide: ConfigService, useValue: { get: configGet } },
      ],
    }).compile();

    const svc = module.get<WeatherFetchService>(WeatherFetchService);
    await svc.fetchWeather();

    expect(mockFetch).not.toHaveBeenCalled();
  });

  it('should handle non-OK response from OpenWeatherMap', async () => {
    mockFetch.mockResolvedValueOnce({ ok: false, status: 401 });

    await service.fetchWeather();

    expect(prisma.weather.create).not.toHaveBeenCalled();
  });

  it('should handle missing school record', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockWeatherResponse),
    });
    prisma.school.findFirst.mockResolvedValueOnce(null);

    await service.fetchWeather();

    expect(prisma.weather.create).not.toHaveBeenCalled();
  });

  it('should create weather record on success', async () => {
    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(mockWeatherResponse),
    });
    prisma.school.findFirst.mockResolvedValueOnce(mockSchool);
    prisma.weather.create.mockResolvedValueOnce({});

    await service.fetchWeather();

    expect(prisma.weather.create).toHaveBeenCalledWith({
      data: expect.objectContaining({
        school_id: 'school-1',
        temperature_f: 72,
        conditions: 'clear sky',
        is_raining: false,
      }),
    });
  });

  it('should detect rain from weather condition', async () => {
    const rainyResponse = {
      ...mockWeatherResponse,
      weather: [{ main: 'Rain', description: 'light rain' }],
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(rainyResponse),
    });
    prisma.school.findFirst.mockResolvedValueOnce(mockSchool);
    prisma.weather.create.mockResolvedValueOnce({});

    await service.fetchWeather();

    expect(prisma.weather.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ is_raining: true }),
    });
  });

  it('should detect rain from precipitation data', async () => {
    const rainData = {
      ...mockWeatherResponse,
      rain: { '1h': 0.5 },
    };

    mockFetch.mockResolvedValueOnce({
      ok: true,
      json: () => Promise.resolve(rainData),
    });
    prisma.school.findFirst.mockResolvedValueOnce(mockSchool);
    prisma.weather.create.mockResolvedValueOnce({});

    await service.fetchWeather();

    expect(prisma.weather.create).toHaveBeenCalledWith({
      data: expect.objectContaining({ is_raining: true }),
    });
  });

  it('should handle fetch errors gracefully', async () => {
    mockFetch.mockRejectedValueOnce(new Error('Network error'));

    // Should not throw
    await service.fetchWeather();

    expect(prisma.weather.create).not.toHaveBeenCalled();
  });
});
