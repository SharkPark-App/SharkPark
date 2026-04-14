import { Test, TestingModule } from '@nestjs/testing';
import { WeatherService } from './weather.service';
import { PrismaService } from '../database/database.module';

describe('WeatherService', () => {
  let service: WeatherService;
  let prisma: {
    weather: { findFirst: jest.Mock };
  };

  beforeEach(async () => {
    prisma = {
      weather: { findFirst: jest.fn() },
    };

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        WeatherService,
        { provide: PrismaService, useValue: prisma },
      ],
    }).compile();

    service = module.get<WeatherService>(WeatherService);
  });

  it('should be defined', () => {
    expect(service).toBeDefined();
  });

  describe('getCurrent', () => {
    it('should return current weather data', async () => {
      const mockWeather = {
        id: 'uuid-1',
        school_id: 'school-1',
        conditions: 'Sunny',
        temperature_f: 72,
        feels_like_f: 70,
        humidity_percent: 45,
        wind_speed_mph: 5,
        precipitation_probability: 0,
        is_raining: false,
        timestamp: new Date(),
        created_at: new Date(),
      };

      prisma.weather.findFirst.mockResolvedValue(mockWeather);

      const result = await service.getCurrent();

      expect(result).toBeDefined();
      expect(result!.conditions).toBe('Sunny');
    });

    it('should return null when no weather data found', async () => {
      prisma.weather.findFirst.mockResolvedValue(null);

      const result = await service.getCurrent();

      expect(result).toBeNull();
    });
  });

  describe('getWeatherImpact', () => {
    const baseWeather = {
      id: 'uuid-1',
      school_id: 'school-1',
      conditions: 'clear sky',
      temperature_f: 72,
      feels_like_f: 70,
      humidity_percent: 45,
      wind_speed_mph: 5,
      precipitation_probability: 0.1,
      is_raining: false,
      timestamp: new Date(),
      created_at: new Date(),
    };

    it('should return factor 1.0 for normal conditions', async () => {
      prisma.weather.findFirst.mockResolvedValue(baseWeather);

      const result = await service.getWeatherImpact();

      expect(result).toBeDefined();
      expect(result!.factor).toBe(1.0);
      expect(result!.description).toBe('Normal weather conditions');
    });

    it('should increase factor when raining', async () => {
      prisma.weather.findFirst.mockResolvedValue({
        ...baseWeather,
        is_raining: true,
        conditions: 'light rain',
      });

      const result = await service.getWeatherImpact();

      expect(result!.factor).toBe(1.15);
      expect(result!.is_raining).toBe(true);
      expect(result!.description).toContain('rain increases demand');
    });

    it('should increase factor for extreme heat', async () => {
      prisma.weather.findFirst.mockResolvedValue({
        ...baseWeather,
        temperature_f: 100,
      });

      const result = await service.getWeatherImpact();

      expect(result!.factor).toBe(1.08);
      expect(result!.description).toContain('extreme heat');
    });

    it('should increase factor for cold weather', async () => {
      prisma.weather.findFirst.mockResolvedValue({
        ...baseWeather,
        temperature_f: 40,
      });

      const result = await service.getWeatherImpact();

      expect(result!.factor).toBe(1.05);
      expect(result!.description).toContain('cold weather');
    });

    it('should combine multiple weather factors', async () => {
      prisma.weather.findFirst.mockResolvedValue({
        ...baseWeather,
        is_raining: true,
        wind_speed_mph: 30,
        temperature_f: 45,
      });

      const result = await service.getWeatherImpact();

      // 1.0 + 0.15 (rain) + 0.05 (cold) + 0.05 (wind) = 1.25
      expect(result!.factor).toBe(1.25);
    });

    it('should return null when no weather data available', async () => {
      prisma.weather.findFirst.mockResolvedValue(null);

      const result = await service.getWeatherImpact();

      expect(result).toBeNull();
    });
  });
});
