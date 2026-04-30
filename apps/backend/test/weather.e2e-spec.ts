import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { bootstrapTestApp } from './utils/bootstrap';

describe('WeatherController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    
    bootstrapTestApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/api/v1/weather/current (GET)', () => {
    it('should return a successful response', () => {
      return request(app.getHttpServer())
        .get('/api/v1/weather/current')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          // data may be null if no weather has been fetched yet
          expect(res.body).toHaveProperty('data');
        });
    });

    it('should have valid weather fields when data is available', () => {
      return request(app.getHttpServer())
        .get('/api/v1/weather/current')
        .expect(200)
        .expect((res: Response) => {
          if (res.body.data === null) {
            // No weather data in test DB — acceptable
            return;
          }
          expect(res.body.data).toHaveProperty('timestamp');
          expect(res.body.data).toHaveProperty('conditions');
          expect(res.body.data).toHaveProperty('temperature_f');
          expect(res.body.data).toHaveProperty('precipitation_probability');
          expect(res.body.data).toHaveProperty('wind_speed_mph');
          expect(res.body.data).toHaveProperty('humidity_percent');
          expect(res.body.data).toHaveProperty('is_raining');
          expect(typeof res.body.data.temperature_f).toBe('number');
          expect(typeof res.body.data.humidity_percent).toBe('number');
          expect(res.body.data.humidity_percent).toBeGreaterThanOrEqual(0);
          expect(res.body.data.humidity_percent).toBeLessThanOrEqual(100);
        });
    });

    it('should have valid precipitation probability when data is available', () => {
      return request(app.getHttpServer())
        .get('/api/v1/weather/current')
        .expect(200)
        .expect((res: Response) => {
          if (res.body.data === null) return;
          const prob = res.body.data.precipitation_probability;
          expect(prob).toBeGreaterThanOrEqual(0);
          expect(prob).toBeLessThanOrEqual(1);
        });
    });

    it('should have is_raining as a boolean when data is available', () => {
      return request(app.getHttpServer())
        .get('/api/v1/weather/current')
        .expect(200)
        .expect((res: Response) => {
          if (res.body.data === null) return;
          expect(typeof res.body.data.is_raining).toBe('boolean');
        });
    });
  });
});
