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
});
