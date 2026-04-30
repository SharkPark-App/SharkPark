import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { bootstrapTestApp } from './utils/bootstrap';

describe('EventsController (e2e)', () => {
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

  describe('/api/v1/events (GET)', () => {
    it('should return all campus events', () => {
      return request(app.getHttpServer())
        .get('/api/v1/events')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.count).toBeGreaterThan(0);
          expect(Array.isArray(res.body.data)).toBe(true);
          
          // Verify event structure
          const event = res.body.data[0];
          expect(event).toHaveProperty('id');
          expect(event).toHaveProperty('event_name');
          expect(event).toHaveProperty('event_type');
          expect(event).toHaveProperty('location');
          expect(event).toHaveProperty('start_time');
          expect(event).toHaveProperty('end_time');
          expect(event).toHaveProperty('expected_attendance');
        });
    });

    it('should filter events by type', () => {
      return request(app.getHttpServer())
        .get('/api/v1/events?type=ATHLETIC')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          res.body.data.forEach((event: { event_type: string }) => {
            expect(event.event_type).toBe('ATHLETIC');
          });
        });
    });

    it('should return 400 for invalid event type', () => {
      return request(app.getHttpServer())
        .get('/api/v1/events?type=INVALID')
        .expect(400);
    });
  });

  describe('/api/v1/events/:eventId/impacts (GET)', () => {
    it('should return parking impacts for basketball game', async () => {
      // First, look up the basketball event by name to get its CUID
      const eventsRes = await request(app.getHttpServer())
        .get('/api/v1/events?type=ATHLETIC')
        .expect(200);

      const basketball = eventsRes.body.data.find(
        (e: { event_name: string }) => e.event_name.includes('Basketball'),
      );
      expect(basketball).toBeDefined();

      return request(app.getHttpServer())
        .get(`/api/v1/events/${basketball.id}/impacts`)
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(Array.isArray(res.body.data)).toBe(true);
          expect(res.body.data.length).toBeGreaterThan(0);
          
          // Verify impact structure
          const impact = res.body.data[0];
          expect(impact).toHaveProperty('lot_id');
          expect(impact).toHaveProperty('impact_level');
          expect(impact).toHaveProperty('expected_increase_percent');
        });
    });

    it('should return impacts for graduation (HIGH impacts)', async () => {
      // Look up the commencement event
      const eventsRes = await request(app.getHttpServer())
        .get('/api/v1/events')
        .expect(200);

      const graduation = eventsRes.body.data.find(
        (e: { event_name: string }) => e.event_name.includes('Commencement'),
      );
      expect(graduation).toBeDefined();

      return request(app.getHttpServer())
        .get(`/api/v1/events/${graduation.id}/impacts`)
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          
          // Graduation should have multiple HIGH impacts
          const highImpacts = res.body.data.filter(
            (i: { impact_level: string }) => i.impact_level === 'HIGH',
          );
          expect(highImpacts.length).toBeGreaterThan(0);
        });
    });

    it('should return empty array for non-existent event', () => {
      return request(app.getHttpServer())
        .get('/api/v1/events/fake-event-123/impacts')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.length).toBe(0);
        });
    });
  });
});
