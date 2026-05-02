import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { PrismaService } from '../src/database/database.module';
import { hashDeviceId } from '../src/occupancy-events/utils/privacy.util';
import { bootstrapTestApp } from './utils/bootstrap';

describe('ReliabilityController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  // Reusable contributor identity for gated endpoints. Mirrors the pattern
  // in lots.e2e-spec: pre-register a device hash in `contributor_ping` and
  // send the matching x-device-id header so ContributorGuard short-circuits
  // to the contributor branch.
  const contributorDeviceId = `e2e-reliability-${Date.now()}`;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();

    bootstrapTestApp(app);
    await app.init();

    prisma = moduleFixture.get<PrismaService>(PrismaService);
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

  describe('/api/v1/reliability/lots/:lotId (GET)', () => {
    it('should return reliability score for a valid lot', () => {
      return request(app.getHttpServer())
        .get('/api/v1/reliability/lots/G1')
        .set('x-device-id', contributorDeviceId)
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data).toHaveProperty('score');
          expect(res.body.data).toHaveProperty('confidence');
          expect(res.body.data).toHaveProperty('factors');
          expect(res.body.data).toHaveProperty('computedAt');
          expect(res.body.data).toHaveProperty('lotId', 'G1');
          expect(res.body.data).toHaveProperty('isColdStart');
          expect(res.body.data).toHaveProperty('explanation');

          // Score should be 0-100
          expect(res.body.data.score).toBeGreaterThanOrEqual(0);
          expect(res.body.data.score).toBeLessThanOrEqual(100);

          // Confidence should be a valid level
          expect(['HIGH', 'MEDIUM', 'LOW']).toContain(res.body.data.confidence);

          // Factors should have all five components
          const { factors } = res.body.data;
          expect(factors).toHaveProperty('penetrationRate');
          expect(factors).toHaveProperty('dataFreshness');
          expect(factors).toHaveProperty('eventFrequency');
          expect(factors).toHaveProperty('sampleSize');
          expect(factors).toHaveProperty('historicalAccuracy');

          // Each factor should have the expected structure
          for (const key of Object.keys(factors)) {
            expect(factors[key]).toHaveProperty('name');
            expect(factors[key]).toHaveProperty('rawValue');
            expect(factors[key]).toHaveProperty('normalizedValue');
            expect(factors[key]).toHaveProperty('weight');
            expect(factors[key]).toHaveProperty('weightedScore');
          }
        });
    });

    it('should return 404 for non-existent lot', () => {
      return request(app.getHttpServer())
        .get('/api/v1/reliability/lots/INVALID')
        .set('x-device-id', contributorDeviceId)
        .expect(404)
        .expect((res: Response) => {
          expect(res.body.success).toBe(false);
          expect(res.body.message).toContain('not found');
        });
    });

    // Reliability is a contributor-tier signal: non-contributors must be
    // gated out the same way they are for /lots/summary and forecasts.
    it('should return 403 BG_LOCATION_REQUIRED for non-contributors', () => {
      return request(app.getHttpServer())
        .get('/api/v1/reliability/lots/G1')
        .set('x-device-id', `e2e-non-contributor-${Date.now()}`)
        .expect(403)
        .expect((res: Response) => {
          expect(res.body.code).toBe('BG_LOCATION_REQUIRED');
        });
    });
  });

  describe('/api/v1/reliability/lots (GET)', () => {
    it('should return reliability summaries for all lots', () => {
      return request(app.getHttpServer())
        .get('/api/v1/reliability/lots')
        .set('x-device-id', contributorDeviceId)
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(Array.isArray(res.body.data)).toBe(true);
          expect(res.body.data.length).toBeGreaterThan(0);

          // Each summary should have the expected fields
          res.body.data.forEach(
            (summary: {
              lotId: string;
              score: number;
              confidence: string;
              isColdStart: boolean;
              computedAt: string;
            }) => {
              expect(summary).toHaveProperty('lotId');
              expect(summary).toHaveProperty('score');
              expect(summary).toHaveProperty('confidence');
              expect(summary).toHaveProperty('isColdStart');
              expect(summary).toHaveProperty('computedAt');

              expect(summary.score).toBeGreaterThanOrEqual(0);
              expect(summary.score).toBeLessThanOrEqual(100);
              expect(['HIGH', 'MEDIUM', 'LOW']).toContain(summary.confidence);
            },
          );
        });
    });
  });

  describe('/api/v1/reliability/config (GET)', () => {
    it('should return reliability weights and thresholds', () => {
      return request(app.getHttpServer())
        .get('/api/v1/reliability/config')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data).toHaveProperty('weights');
          expect(res.body.data).toHaveProperty('thresholds');

          // Weights should have all five factors
          const { weights } = res.body.data;
          expect(weights).toHaveProperty('penetrationRate');
          expect(weights).toHaveProperty('dataFreshness');
          expect(weights).toHaveProperty('eventFrequency');
          expect(weights).toHaveProperty('sampleSize');
          expect(weights).toHaveProperty('historicalAccuracy');

          // Weights should sum to 1.0
          const weightSum = Object.values(weights).reduce(
            (sum: number, v) => sum + (v as number),
            0,
          );
          expect(weightSum).toBeCloseTo(1.0, 2);

          // Thresholds should have expected fields
          const { thresholds } = res.body.data;
          expect(thresholds).toHaveProperty('highConfidence');
          expect(thresholds).toHaveProperty('mediumConfidence');
          expect(thresholds).toHaveProperty('penetrationRateTarget');
          expect(thresholds).toHaveProperty('freshnessWindowMinutes');
          expect(thresholds).toHaveProperty('eventFrequencyTarget');
          expect(thresholds).toHaveProperty('sampleSizeTarget');

          // Threshold ordering: high > medium
          expect(thresholds.highConfidence).toBeGreaterThan(
            thresholds.mediumConfidence,
          );
        });
    });
  });
});
