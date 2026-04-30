import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/database.module';
import { hashDeviceId } from '../src/occupancy-events/utils/privacy.util';
import { bootstrapTestApp } from './utils/bootstrap';

describe('LotsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  // Reusable contributor identity for gated endpoints. Must be sent as the
  // x-device-id header on any request that hits a ContributorGuard route.
  const contributorDeviceId = `e2e-contributor-${Date.now()}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    
    bootstrapTestApp(app);
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
    // Pre-register the test device as an active contributor so guarded
    // endpoints behave like they would in production after a recent ping.
    await prisma.contributorPing.upsert({
      where: { device_hash: hashDeviceId(contributorDeviceId) },
      update: { last_seen_at: new Date() },
      create: { device_hash: hashDeviceId(contributorDeviceId), last_seen_at: new Date() },
    });
  });

  afterAll(async () => {
    await prisma.contributorPing.deleteMany({
      where: { device_hash: hashDeviceId(contributorDeviceId) },
    });
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
        .set('x-device-id', contributorDeviceId)
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
        .set('x-device-id', contributorDeviceId)
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
        .set('x-device-id', contributorDeviceId)
        .expect(200)
        .expect((res: Response) => {
          const lotIds = res.body.data.map((r: { lot_id: string }) => r.lot_id);
          expect(lotIds).not.toContain('G1');
        });
    });

    it('should only return lots of the same type as the source', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/G1/recommendations')
        .set('x-device-id', contributorDeviceId)
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
        .set('x-device-id', contributorDeviceId)
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
        .set('x-device-id', contributorDeviceId)
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
        .set('x-device-id', contributorDeviceId)
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.data.length).toBeLessThanOrEqual(2);
        });
    });

    it('should also work for employee lots', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/E1/recommendations')
        .set('x-device-id', contributorDeviceId)
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
        .set('x-device-id', contributorDeviceId)
        .expect(404);
    });

    it('should handle lowercase lot IDs', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/g1/recommendations')
        .set('x-device-id', contributorDeviceId)
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.source_lot).toBe('G1');
        });
    });
  });

  // ACCESS-1: lock the public-tier contract.
  // Per the reciprocity access model, map data and lot details MUST be
  // reachable with no Authorization header and no x-device-id. This is what
  // boot-into-public-map and "browse before sign-in" depend on. If a future
  // change accidentally puts these behind a guard, this block fails fast.
  describe('ACCESS-1: public tier (no auth, no device header)', () => {
    const noAuth = (path: string) =>
      request(app.getHttpServer())
        .get(path)
        // Explicitly assert nothing is sent — supertest defaults already do
        // this, but we strip any inherited headers to make the contract
        // unambiguous.
        .set('Authorization', '')
        .set('x-device-id', '');

    it('GET /lots is public', () =>
      noAuth('/api/v1/lots').expect(200));

    it('GET /lots/:id is public', () =>
      noAuth('/api/v1/lots/G1').expect(200));

    it('GET /lots/:id (404 path) does not require auth', () =>
      noAuth('/api/v1/lots/INVALID').expect(404));
  });

  // ACCESS-2: lock the contributor-gated tier.
  // Live occupancy summary and forecast endpoints must require the
  // x-device-id header AND a recent ContributorPing. Failures must return
  // 403 with body { code: 'BG_LOCATION_REQUIRED' } so the mobile client can
  // map the response straight to the soft-ask UX.
  describe('ACCESS-2: contributor tier (BG_LOCATION_REQUIRED)', () => {
    it('GET /lots/summary returns 403 BG_LOCATION_REQUIRED without x-device-id', () =>
      request(app.getHttpServer())
        .get('/api/v1/lots/summary')
        .expect(403)
        .expect((res: Response) => {
          expect(res.body?.code ?? res.body?.error?.code).toBe('BG_LOCATION_REQUIRED');
        }));

    it('GET /lots/:id/recommendations returns 403 BG_LOCATION_REQUIRED without x-device-id', () =>
      request(app.getHttpServer())
        .get('/api/v1/lots/G1/recommendations')
        .expect(403)
        .expect((res: Response) => {
          expect(res.body?.code ?? res.body?.error?.code).toBe('BG_LOCATION_REQUIRED');
        }));

    it('GET /lots/:id/predictions/short-term returns 403 without x-device-id', () =>
      request(app.getHttpServer())
        .get('/api/v1/lots/G1/predictions/short-term')
        .expect(403));

    it('GET /lots/:id/predictions/long-term returns 403 without x-device-id', () =>
      request(app.getHttpServer())
        .get('/api/v1/lots/G1/predictions/long-term')
        .expect(403));

    it('GET /lots/summary returns 200 with a fresh contributor device-id', () =>
      request(app.getHttpServer())
        .get('/api/v1/lots/summary')
        .set('x-device-id', contributorDeviceId)
        .expect(200));

    it('GET /lots/summary returns 403 for an unknown device-id', () =>
      request(app.getHttpServer())
        .get('/api/v1/lots/summary')
        .set('x-device-id', `unknown-device-${Date.now()}`)
        .expect(403)
        .expect((res: Response) => {
          expect(res.body?.code ?? res.body?.error?.code).toBe('BG_LOCATION_REQUIRED');
        }));
  });
});
