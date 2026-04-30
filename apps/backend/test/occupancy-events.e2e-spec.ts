import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, CanActivate } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { AzureAdGuard } from '../src/auth/azure-ad.guard';
import { bootstrapTestApp } from './utils/bootstrap';

/** Mock guard to bypass Azure AD auth in e2e tests */
class MockAuthGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

describe('OccupancyEventsController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
    .overrideGuard(AzureAdGuard)
    .useClass(MockAuthGuard)
    .compile();

    app = moduleFixture.createNestApplication();

    bootstrapTestApp(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/api/v1/occupancy-events (POST)', () => {
    it('should record an ENTER event', () => {
      return request(app.getHttpServer())
        .post('/api/v1/occupancy-events')
        .send({
          lot_id: 'G1',
          event_type: 'ENTER',
          device_id: 'e2e-test-device-12345678',
          timestamp: new Date().toISOString(),
        })
        .expect(201)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data).toHaveProperty('event_id');
          expect(res.body.data.lot_id).toBe('G1');
          expect(res.body.data.event_type).toBe('ENTER');
          expect(typeof res.body.data.deduplicated).toBe('boolean');
        });
    });

    it('should record an EXIT event', () => {
      return request(app.getHttpServer())
        .post('/api/v1/occupancy-events')
        .send({
          lot_id: 'G1',
          event_type: 'EXIT',
          device_id: 'e2e-test-device-12345678',
          timestamp: new Date().toISOString(),
        })
        .expect(201)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.event_type).toBe('EXIT');
        });
    });

    it('should deduplicate consecutive same-type events', async () => {
      const deviceId = `e2e-dedup-test-${Date.now()}`;

      // First ENTER
      await request(app.getHttpServer())
        .post('/api/v1/occupancy-events')
        .send({
          lot_id: 'G1',
          event_type: 'ENTER',
          device_id: deviceId,
          timestamp: new Date().toISOString(),
        })
        .expect(201);

      // Second ENTER (should be deduplicated)
      return request(app.getHttpServer())
        .post('/api/v1/occupancy-events')
        .send({
          lot_id: 'G1',
          event_type: 'ENTER',
          device_id: deviceId,
          timestamp: new Date().toISOString(),
        })
        .expect(201)
        .expect((res: Response) => {
          expect(res.body.data.deduplicated).toBe(true);
          expect(res.body.message).toBe('Duplicate event ignored');
        });
    });

    it('should reject invalid event_type', () => {
      return request(app.getHttpServer())
        .post('/api/v1/occupancy-events')
        .send({
          lot_id: 'G1',
          event_type: 'INVALID',
          device_id: 'test-device-12345678',
          timestamp: new Date().toISOString(),
        })
        .expect(400);
    });

    it('should reject missing device_id', () => {
      return request(app.getHttpServer())
        .post('/api/v1/occupancy-events')
        .send({
          lot_id: 'G1',
          event_type: 'ENTER',
          timestamp: new Date().toISOString(),
        })
        .expect(400);
    });

    it('should reject invalid timestamp format', () => {
      return request(app.getHttpServer())
        .post('/api/v1/occupancy-events')
        .send({
          lot_id: 'G1',
          event_type: 'ENTER',
          device_id: 'test-device-12345678',
          timestamp: 'not-a-valid-timestamp',
        })
        .expect(400);
    });

    it('should reject device_id that is too short', () => {
      return request(app.getHttpServer())
        .post('/api/v1/occupancy-events')
        .send({
          lot_id: 'G1',
          event_type: 'ENTER',
          device_id: 'short',
          timestamp: new Date().toISOString(),
        })
        .expect(400);
    });
  });

  describe('/api/v1/occupancy-events/lots/:lotId (GET)', () => {
    it('should return events for a lot', () => {
      return request(app.getHttpServer())
        .get('/api/v1/occupancy-events/lots/G1')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.lot_id).toBe('G1');
          expect(Array.isArray(res.body.data)).toBe(true);
          expect(res.body).toHaveProperty('count');
        });
    });

    it('should accept date range parameters', () => {
      const today = new Date().toISOString().split('T')[0];
      return request(app.getHttpServer())
        .get(`/api/v1/occupancy-events/lots/G1?start=${today}&end=${today}T23:59:59Z`)
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.start_date).toBe(today);
        });
    });

    it('should reject invalid date format', () => {
      return request(app.getHttpServer())
        .get('/api/v1/occupancy-events/lots/G1?start=invalid-date')
        .expect(400);
    });
  });

  describe('/api/v1/occupancy-events/lots/:lotId/stats (GET)', () => {
    it('should return event statistics', () => {
      return request(app.getHttpServer())
        .get('/api/v1/occupancy-events/lots/G1/stats')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data).toHaveProperty('lot_id');
          expect(res.body.data).toHaveProperty('total_enters');
          expect(res.body.data).toHaveProperty('total_exits');
          expect(res.body.data).toHaveProperty('net_change');
        });
    });

    it('should accept date range parameters', () => {
      const today = new Date().toISOString().split('T')[0];
      return request(app.getHttpServer())
        .get(`/api/v1/occupancy-events/lots/G1/stats?start=${today}&end=${today}T23:59:59Z`)
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.data.start_date).toBe(today);
        });
    });
  });

  describe('/api/v1/occupancy-events/snapshots/:lotId (GET)', () => {
    it('should return snapshots for a lot', () => {
      const today = new Date().toISOString().split('T')[0];
      return request(app.getHttpServer())
        .get(`/api/v1/occupancy-events/snapshots/G1?date=${today}`)
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.lot_id).toBe('G1');
          expect(res.body.date).toBe(today);
          expect(Array.isArray(res.body.data)).toBe(true);
        });
    });

    it('should use today as default date', () => {
      const today = new Date().toISOString().split('T')[0];
      return request(app.getHttpServer())
        .get('/api/v1/occupancy-events/snapshots/G1')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.date).toBe(today);
        });
    });

    it('should reject invalid date format', () => {
      return request(app.getHttpServer())
        .get('/api/v1/occupancy-events/snapshots/G1?date=invalid')
        .expect(400);
    });
  });
});
