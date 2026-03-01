import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';

describe('LotsController (e2e)', () => {
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

  describe('/api/v1/lots (GET)', () => {
    it('should return all parking lots', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.count).toBeGreaterThan(0);
          expect(Array.isArray(res.body.data)).toBe(true);
        });
    });

    it('should filter by lot type', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots?type=STUDENT')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          res.body.data.forEach((lot: { lot_type: string }) => {
            expect(lot.lot_type).toBe('STUDENT');
          });
        });
    });

    it('should filter by available_only', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots?available_only=true')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          res.body.data.forEach((lot: { available: number }) => {
            expect(lot.available).toBeGreaterThan(0);
          });
        });
    });
  });

  describe('/api/v1/lots/summary (GET)', () => {
    it('should return occupancy summary', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/summary')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data).toHaveProperty('total_lots');
          expect(res.body.data).toHaveProperty('total_capacity');
          expect(res.body.data).toHaveProperty('total_occupied');
          expect(res.body.data).toHaveProperty('overall_occupancy_rate');
        });
    });
  });

  describe('/api/v1/lots/:id (GET)', () => {
    it('should return specific lot', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/G1')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.lot_id).toBe('G1');
          expect(res.body.data).toHaveProperty('capacity');
          expect(res.body.data).toHaveProperty('current_occupancy');
          expect(res.body.data).toHaveProperty('available');
          expect(res.body.data).toHaveProperty('occupancy_rate');
          expect(res.body.data).toHaveProperty('fill_status');
        });
    });

    it('should return 404 for non-existent lot', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/INVALID')
        .expect(404);
    });
  });

  describe('/api/v1/lots/:id/history (GET)', () => {
    it('should return historical data', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/G1/history?date=2025-12-13&limit=5')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.lot_id).toBe('G1');
          expect(Array.isArray(res.body.data)).toBe(true);
        });
    });
  });

  describe('/api/v1/lots/:id/recommendations (GET)', () => {
    it('should return recommendations for a valid lot', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/G1/recommendations')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.source_lot).toBe('G1');
          expect(Array.isArray(res.body.data)).toBe(true);
          expect(res.body.count).toBe(res.body.data.length);

          // Each recommendation should have required fields
          res.body.data.forEach((rec: Record<string, unknown>) => {
            expect(rec).toHaveProperty('lot_id');
            expect(rec).toHaveProperty('recommendation_score');
            expect(rec).toHaveProperty('distance_meters');
            expect(rec).toHaveProperty('reason');
            expect(rec).toHaveProperty('available');
            expect(rec).toHaveProperty('fill_status');
            expect(typeof rec.recommendation_score).toBe('number');
            expect(typeof rec.distance_meters).toBe('number');
          });
        });
    });

    it('should not include the source lot in recommendations', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/G1/recommendations')
        .expect(200)
        .expect((res: Response) => {
          const lotIds = res.body.data.map((r: { lot_id: string }) => r.lot_id);
          expect(lotIds).not.toContain('G1');
        });
    });

    it('should only return lots of the same type as the source', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/G1/recommendations')
        .expect(200)
        .expect((res: Response) => {
          res.body.data.forEach((rec: { lot_type: string }) => {
            expect(rec.lot_type).toBe('STUDENT');
          });
        });
    });

    it('should not include full lots (≥95% occupancy)', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/G1/recommendations')
        .expect(200)
        .expect((res: Response) => {
          res.body.data.forEach((rec: { occupancy_rate: number }) => {
            expect(rec.occupancy_rate).toBeLessThan(0.95);
          });
        });
    });

    it('should return recommendations sorted by score (descending)', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/G1/recommendations')
        .expect(200)
        .expect((res: Response) => {
          const scores = res.body.data.map((r: { recommendation_score: number }) => r.recommendation_score);
          for (let i = 1; i < scores.length; i++) {
            expect(scores[i - 1]).toBeGreaterThanOrEqual(scores[i]);
          }
        });
    });

    it('should respect the limit parameter', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/G1/recommendations?limit=2')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.data.length).toBeLessThanOrEqual(2);
        });
    });

    it('should also work for employee lots', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/E1/recommendations')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.source_lot).toBe('E1');
          res.body.data.forEach((rec: { lot_type: string }) => {
            expect(rec.lot_type).toBe('EMPLOYEE');
          });
        });
    });

    it('should return 404 for non-existent lot', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/INVALID/recommendations')
        .expect(404);
    });

    it('should handle lowercase lot IDs', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/g1/recommendations')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.source_lot).toBe('G1');
        });
    });
  });
});
