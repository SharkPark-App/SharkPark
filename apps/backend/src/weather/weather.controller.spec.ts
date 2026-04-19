import { Test, TestingModule } from '@nestjs/testing';
import { WeatherController } from './weather.controller';
import { WeatherService } from './weather.service';

describe('WeatherController', () => {
  let controller: WeatherController;
  let service: WeatherService;

  const mockWeatherService = {
    getCurrent: jest.fn(),
    getWeatherImpact: jest.fn(),
  };

  beforeEach(async () => {
    const module: TestingModule = await Test.createTestingModule({
      controllers: [WeatherController],
      providers: [
        {
          provide: WeatherService,
          useValue: mockWeatherService,
        },
      ],
    }).compile();

    controller = module.get<WeatherController>(WeatherController);
    service = module.get<WeatherService>(WeatherService);
  });

  it('should be defined', () => {
    expect(controller).toBeDefined();
  });

  describe('getCurrentWeather', () => {
    it('should return current weather data', async () => {
      const mockWeather = {
        date: '2025-12-14',
        condition: 'Sunny',
        temperature_f: 72,
        parking_impact_factor: 1.0,
        forecast_7day: [],
      };

      mockWeatherService.getCurrent.mockResolvedValue(mockWeather);

      const result = await controller.getCurrentWeather();

      expect(result).toEqual({
        success: true,
        data: mockWeather,
      });
      expect(service.getCurrent).toHaveBeenCalled();
    });

    it('should include parking impact factor in response', async () => {
      const mockWeather = {
        date: '2025-12-14',
        condition: 'Rainy',
        temperature_f: 62,
        parking_impact_factor: 1.25,
        forecast_7day: [],
      };

      mockWeatherService.getCurrent.mockResolvedValue(mockWeather);

      const result = await controller.getCurrentWeather();

      expect(result.data).toBeDefined();
      if (result.data) {
        expect((result.data as unknown as { parking_impact_factor: number }).parking_impact_factor).toBe(1.25);
      }
    });
  });

  describe('getWeatherImpact', () => {
    it('should return weather impact data', async () => {
      const mockImpact = {
        factor: 1.15,
        description: 'Weather impact: rain increases demand (+15% demand)',
        conditions: 'light rain',
        is_raining: true,
        temperature_f: 65,
      };

      mockWeatherService.getWeatherImpact.mockResolvedValue(mockImpact);

      const result = await controller.getWeatherImpact();

      expect(result).toEqual({
        success: true,
        data: mockImpact,
      });
    });

    it('should return null data when no weather available', async () => {
      mockWeatherService.getWeatherImpact.mockResolvedValue(null);

      const result = await controller.getWeatherImpact();

      expect(result).toEqual({
        success: true,
        data: null,
      });
    });
  });
});
