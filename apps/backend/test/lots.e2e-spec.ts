import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/database.module';
import { hashDeviceId } from '../src/occupancy-events/utils/privacy.util';
import { studentEligibleLotTypes } from '../src/lots/csulb-eligibility';
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
        .set('x-device-id', contributorDeviceId)
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
        .set('x-device-id', contributorDeviceId)
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
        .set('x-device-id', contributorDeviceId)
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          res.body.data.forEach((lot: { available: number }) => {
            expect(lot.available).toBeGreaterThan(0);
          });
        });
    });

    // ─── Live-data redaction (Apple App Review 5.1.1 compliance) ───
    //
    // /lots is publicly readable (lot metadata is non-sensitive), but the
    // live occupancy fields are derived from contributor-tier device pings
    // and must NOT leak to non-contributors. We redact those fields to null
    // and serve `Cache-Control: private` so the CDN never cross-tenants the
    // response.
    it('redacts live occupancy fields when caller is not a contributor', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(Array.isArray(res.body.data)).toBe(true);
          expect(res.body.data.length).toBeGreaterThan(0);
          for (const lot of res.body.data) {
            // Static metadata still present
            expect(lot.lot_id).toBeDefined();
            expect(lot.lot_name).toBeDefined();
            expect(typeof lot.capacity).toBe('number');
            // All eight live-data fields redacted to null
            expect(lot.current_occupancy).toBeNull();
            expect(lot.available).toBeNull();
            expect(lot.occupancy_rate).toBeNull();
            expect(lot.fill_status).toBeNull();
            expect(lot.estimated_occupancy).toBeNull();
            expect(lot.estimated_available).toBeNull();
            expect(lot.raw_occupancy).toBeNull();
            expect(lot.effective_penetration_rate).toBeNull();
          }
        });
    });

    it('serves Cache-Control: private on redactable list endpoint', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots')
        .expect(200)
        .expect((res: Response) => {
          // Must NOT be `public` — that would let the CDN serve a contributor
          // response to a non-contributor (or vice versa) within the TTL.
          expect(res.headers['cache-control']).toContain('private');
          expect(res.headers['cache-control']).not.toContain('public');
        });
    });

    it('silently drops available_only filter for non-contributors (cardinality-leak prevention)', () => {
      // Because we redact `available` to null, honoring `available_only=true`
      // would still narrow the result-set and effectively leak which lots
      // have spots. We degrade gracefully: return the full unfiltered list.
      return Promise.all([
        request(app.getHttpServer()).get('/api/v1/lots').expect(200),
        request(app.getHttpServer())
          .get('/api/v1/lots?available_only=true&min_available=50')
          .expect(200),
      ]).then(([all, filtered]) => {
        expect(filtered.body.count).toBe(all.body.count);
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
        .set('x-device-id', contributorDeviceId)
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

    it('redacts live fields for non-contributors but preserves metadata', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/G1')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.data.lot_id).toBe('G1');
          expect(res.body.data.lot_name).toBeDefined();
          expect(typeof res.body.data.capacity).toBe('number');
          expect(res.body.data.current_occupancy).toBeNull();
          expect(res.body.data.occupancy_rate).toBeNull();
          expect(res.body.data.fill_status).toBeNull();
          // Cache must be private on this endpoint too
          expect(res.headers['cache-control']).toContain('private');
        });
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

  describe('/api/v1/lots/utilization (GET)', () => {
    it('should return per-lot utilization with default range', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/utilization')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.range_days).toBe(30);
          expect(typeof res.body.count).toBe('number');
          expect(Array.isArray(res.body.data)).toBe(true);
          expect(res.body.count).toBe(res.body.data.length);
        });
    });

    it('should accept a custom range', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/utilization?range=7d')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.range_days).toBe(7);
        });
    });

    it('each item has the expected shape', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/utilization')
        .expect(200)
        .expect((res: Response) => {
          for (const item of res.body.data) {
            expect(item).toHaveProperty('lot_id');
            expect(item).toHaveProperty('display_name');
            expect(item).toHaveProperty('lot_type');
            expect(typeof item.capacity).toBe('number');
            expect(item).toHaveProperty('avg_utilization');
            expect(item).toHaveProperty('avg_estimated_utilization');
            expect(typeof item.snapshot_count).toBe('number');
          }
        });
    });
  });

  describe('/api/v1/lots/:id/trends (GET)', () => {
    it('should return trend data with default range', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/G1/trends')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.lot_id).toBe('G1');
          expect(res.body.range_days).toBe(7);
          expect(typeof res.body.count).toBe('number');
          expect(Array.isArray(res.body.data)).toBe(true);
          expect(res.body.count).toBe(res.body.data.length);
        });
    });

    it('should accept a custom range', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/G1/trends?range=30d')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.range_days).toBe(30);
        });
    });

    it('each trend point has the expected shape', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/G1/trends')
        .expect(200)
        .expect((res: Response) => {
          for (const point of res.body.data) {
            expect(typeof point.hour).toBe('string');
            expect(typeof point.avg_occupancy_rate).toBe('number');
            expect(typeof point.avg_occupancy).toBe('number');
            expect(typeof point.avg_available).toBe('number');
            expect(point).toHaveProperty('avg_estimated_occupancy');
            expect(point).toHaveProperty('avg_estimated_rate');
            expect(typeof point.sample_count).toBe('number');
          }
        });
    });

    it('should uppercase lot id and return 404 for unknown lot', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/INVALID/trends')
        .expect(404);
    });

    it('should handle lowercase lot id', () => {
      return request(app.getHttpServer())
        .get('/api/v1/lots/g1/trends')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.lot_id).toBe('G1');
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

    it('should only return lots eligible for the source lot type', () => {
      // G1 is a STUDENT lot. Per csulb-eligibility, students may also park in
      // EMPLOYEE lots after 17:30 weekdays and any time on weekends, so the
      // eligible set is time-of-day dependent. Compute it the same way the
      // service does so this assertion is not flaky across CI run times.
      const eligible = studentEligibleLotTypes(new Date(), 'America/Los_Angeles');
      return request(app.getHttpServer())
        .get('/api/v1/lots/G1/recommendations')
        .set('x-device-id', contributorDeviceId)
        .expect(200)
        .expect((res: Response) => {
          res.body.data.forEach((rec: { lot_type: string }) => {
            expect(eligible.has(rec.lot_type as 'STUDENT' | 'EMPLOYEE')).toBe(true);
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

    it('GET /lots/utilization is public', () =>
      noAuth('/api/v1/lots/utilization').expect(200));

    it('GET /lots/:id is public', () =>
      noAuth('/api/v1/lots/G1').expect(200));

    it('GET /lots/:id/trends is public', () =>
      noAuth('/api/v1/lots/G1/trends').expect(200));

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
