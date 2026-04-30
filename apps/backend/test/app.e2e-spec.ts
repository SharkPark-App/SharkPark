import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { API_PREFIX } from '../src/constants';

describe('App (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix(API_PREFIX);
    await app.init();
  });

  // /health/live is the cheap "process is up" probe. /health and
  // /health/ready add a Terminus DB+memory check that is asserted in
  // health.controller.spec.ts (unit) and is environmentally flaky here
  // (jest worker heap can exceed the 200 MB threshold).
  it(`/${API_PREFIX}/health/live (GET) returns liveness probe`, async () => {
    await request(app.getHttpServer())
      .get(`/${API_PREFIX}/health/live`)
      .expect(200)
      .expect({ status: 'ok' });
  });

  // Owner-decorator coverage: POST /reports is Authenticated via the global
  // AzureAdGuard (no per-route @UseGuards). Assert anonymous calls 401 so the
  // global-guard enforcement can't silently regress.
  it(`/${API_PREFIX}/reports (POST) without bearer token returns 401`, async () => {
    await request(app.getHttpServer())
      .post(`/${API_PREFIX}/reports`)
      .send({})
      .expect(401);
  });

  afterAll(async () => {
    await app.close();
  });
});
