// test/shuttle-tracker.e2e-spec.ts
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

describe('ShuttleTrackerController (e2e)', () => {
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
    // Initial data fetched implicitly via ShuttleTrackerService onModuleInit
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/api/v1/transit/shuttles (GET)', () => {
    it('should return a success response with an array of live shuttles', () => {
      return request(app.getHttpServer())
        .get('/api/v1/transit/shuttles')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(typeof res.body.count).toBe('number');
          expect(Array.isArray(res.body.data)).toBe(true);

          // If shuttles are active, verify their structure
          if (res.body.count > 0) {
            const shuttle = res.body.data[0];
            expect(shuttle).toHaveProperty('id');
            expect(shuttle).toHaveProperty('busName');
            expect(shuttle).toHaveProperty('latitude');
            expect(shuttle).toHaveProperty('longitude');
            expect(shuttle).toHaveProperty('heading');
          }
        });
    });
  });

  describe('/api/v1/transit/routes (GET)', () => {
    it('should return a success response with an array of cached routes', () => {
      return request(app.getHttpServer())
        .get('/api/v1/transit/routes')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(typeof res.body.count).toBe('number');
          expect(Array.isArray(res.body.data)).toBe(true);

          if (res.body.count > 0) {
            const route = res.body.data[0];
            expect(route).toHaveProperty('id');
            expect(route).toHaveProperty('name');
            expect(route).toHaveProperty('color');
            expect(Array.isArray(route.coordinates)).toBe(true);
          }
        });
    });
  });

  describe('/api/v1/transit/stops (GET)', () => {
    it('should return a success response with an array of cached stops', () => {
      return request(app.getHttpServer())
        .get('/api/v1/transit/stops')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(typeof res.body.count).toBe('number');
          expect(Array.isArray(res.body.data)).toBe(true);

          if (res.body.count > 0) {
            const stop = res.body.data[0];
            expect(stop).toHaveProperty('id');
            expect(stop).toHaveProperty('name');
            expect(stop).toHaveProperty('latitude');
            expect(stop).toHaveProperty('longitude');
            expect(stop).toHaveProperty('routeId');
          }
        });
    });
  });

  describe('/api/v1/transit/etas/:stopId (GET)', () => {
    it('should return a success response with ETAs for a valid stop', () => {
      // 154358 = stopId of Beachside College
      // If ever invalid, empty array is returned
      const testStopId = '154358'; 

      return request(app.getHttpServer())
        .get(`/api/v1/transit/etas/${testStopId}`)
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(typeof res.body.count).toBe('number');
          expect(Array.isArray(res.body.data)).toBe(true);

          if (res.body.count > 0) {
            const eta = res.body.data[0];
            expect(eta).toHaveProperty('routeId');
            expect(eta).toHaveProperty('routeName');
            expect(eta).toHaveProperty('etaMinutes');
          }
        });
    });

    it('should gracefully handle requests for non-existent stop IDs', () => {
      return request(app.getHttpServer())
        .get('/api/v1/transit/etas/non-existent-stop-id')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.count).toBe(0);
          expect(res.body.data).toEqual([]);
        });
    });
  });
});