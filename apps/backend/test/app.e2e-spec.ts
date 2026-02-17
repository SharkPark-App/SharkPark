import request from 'supertest';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { AppModule } from '../src/app.module';
import { API_PREFIX, SERVICE_NAME } from '../src/constants';

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

  it(`/${API_PREFIX}/health (GET)`, async () => {
    await request(app.getHttpServer())
      .get(`/${API_PREFIX}/health`)
      .expect(200)
      .expect((res) => {
        expect(res.body).toMatchObject({
          ok: true,
          service: SERVICE_NAME,
          database: 'connected',
        });
        expect(res.body).toHaveProperty('timestamp');
      });
  });

  afterAll(async () => {
    await app.close();
  });
});
