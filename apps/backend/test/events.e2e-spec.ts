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

  describe('GET /api/v1/events/for-lot/:lotId', () => {
    it('should return 200 with an empty array for a lot with no nearby events', () => {
      return request(app.getHttpServer())
        .get('/api/v1/events/for-lot/G1')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(Array.isArray(res.body.data)).toBe(true);
          expect(typeof res.body.count).toBe('number');
        });
    });

    it('should return 200 for an unknown lot (graceful empty)', () => {
      return request(app.getHttpServer())
        .get('/api/v1/events/for-lot/UNKNOWN')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data).toEqual([]);
          expect(res.body.count).toBe(0);
        });
    });
  });
});
