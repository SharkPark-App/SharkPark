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
});
