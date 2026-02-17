import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

describe('WeatherController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/api/v1/weather/current (GET)', () => {
    it('should return current weather data', () => {
      return request(app.getHttpServer())
        .get('/api/v1/weather/current')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data).toHaveProperty('timestamp');
          expect(res.body.data).toHaveProperty('conditions');
          expect(res.body.data).toHaveProperty('temperature_f');
          expect(res.body.data).toHaveProperty('precipitation_probability');
          expect(res.body.data).toHaveProperty('wind_speed_mph');
          expect(res.body.data).toHaveProperty('humidity_percent');
          expect(res.body.data).toHaveProperty('is_raining');
        });
    });

    it('should have valid temperature and humidity values', () => {
      return request(app.getHttpServer())
        .get('/api/v1/weather/current')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(typeof res.body.data.temperature_f).toBe('number');
          expect(typeof res.body.data.humidity_percent).toBe('number');
          expect(res.body.data.humidity_percent).toBeGreaterThanOrEqual(0);
          expect(res.body.data.humidity_percent).toBeLessThanOrEqual(100);
        });
    });

    it('should have precipitation probability between 0 and 1', () => {
      return request(app.getHttpServer())
        .get('/api/v1/weather/current')
        .expect(200)
        .expect((res: Response) => {
          const prob = res.body.data.precipitation_probability;
          expect(prob).toBeGreaterThanOrEqual(0);
          expect(prob).toBeLessThanOrEqual(1);
        });
    });

    it('should have is_raining as a boolean', () => {
      return request(app.getHttpServer())
        .get('/api/v1/weather/current')
        .expect(200)
        .expect((res: Response) => {
          expect(typeof res.body.data.is_raining).toBe('boolean');
        });
    });
  });
});
