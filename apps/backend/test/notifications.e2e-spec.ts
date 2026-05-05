import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, CanActivate, ExecutionContext } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { AzureAdGuard } from '../src/auth/azure-ad.guard';
import { PrismaService } from '../src/database/database.module';
import { bootstrapTestApp } from './utils/bootstrap';

const TEST_EMAIL = 'notif-e2e-test@csulb.edu';

/** Mock guard to bypass Azure AD auth in e2e tests */
class MockAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    context.switchToHttp().getRequest().user = { email: TEST_EMAIL };
    return true;
  }
}

describe('NotificationsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
      .overrideGuard(AzureAdGuard)
      .useClass(MockAuthGuard)
      .overrideProvider(AzureAdGuard)
      .useClass(MockAuthGuard)
      .compile();

    app = moduleFixture.createNestApplication();
    bootstrapTestApp(app);
    await app.init();
    prisma = moduleFixture.get<PrismaService>(PrismaService);

    const school = await prisma.school.findFirstOrThrow();
    await prisma.user.create({
      data: {
        email: TEST_EMAIL,
        first_name: 'Notif',
        last_name: 'E2E',
        user_type: 'STUDENT',
        school: { connect: { id: school.id } },
      },
    });
  });

  afterAll(async () => {
    // push_tokens cascade-deletes with the user row
    await prisma.user.deleteMany({ where: { email: TEST_EMAIL } });
    await app.close();
  });

  describe('POST /api/v1/users/me/push-token', () => {
    it('registers a new push token and returns 204', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/users/me/push-token')
        .send({ token: 'fcm-e2e-token-ios', platform: 'ios' })
        .expect(204);

      const row = await prisma.pushToken.findUnique({
        where: { token: 'fcm-e2e-token-ios' },
      });
      expect(row).not.toBeNull();
      expect(row!.platform).toBe('ios');
    });

    it('is idempotent — re-registering the same token does not duplicate the row', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/users/me/push-token')
        .send({ token: 'fcm-e2e-token-ios', platform: 'ios' })
        .expect(204);

      const rows = await prisma.pushToken.findMany({
        where: { token: 'fcm-e2e-token-ios' },
      });
      expect(rows).toHaveLength(1);
    });

    it('updates the platform when the same token is re-registered', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/users/me/push-token')
        .send({ token: 'fcm-e2e-token-ios', platform: 'android' })
        .expect(204);

      const row = await prisma.pushToken.findUnique({
        where: { token: 'fcm-e2e-token-ios' },
      });
      expect(row!.platform).toBe('android');
    });

    it('accepts an android token', async () => {
      await request(app.getHttpServer())
        .post('/api/v1/users/me/push-token')
        .send({ token: 'fcm-e2e-token-android', platform: 'android' })
        .expect(204);

      const row = await prisma.pushToken.findUnique({
        where: { token: 'fcm-e2e-token-android' },
      });
      expect(row).not.toBeNull();
    });

    it('returns 400 when token is missing', () => {
      return request(app.getHttpServer())
        .post('/api/v1/users/me/push-token')
        .send({ platform: 'ios' })
        .expect(400)
        .expect((res: Response) => {
          expect(res.body.success).toBe(false);
        });
    });

    it('returns 400 when platform is an unrecognised value', () => {
      return request(app.getHttpServer())
        .post('/api/v1/users/me/push-token')
        .send({ token: 'fcm-some-token', platform: 'web' })
        .expect(400)
        .expect((res: Response) => {
          expect(res.body.success).toBe(false);
        });
    });

    it('returns 400 when the body is empty', () => {
      return request(app.getHttpServer())
        .post('/api/v1/users/me/push-token')
        .send({})
        .expect(400);
    });
  });
});
