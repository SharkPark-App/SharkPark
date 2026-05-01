import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, CanActivate, ExecutionContext } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AzureAdGuard } from '../src/auth/azure-ad.guard';
import { bootstrapTestApp } from './utils/bootstrap';
import { PrismaService } from '../src/database/database.module';

let mockUserId = '';

/** Mock guard to bypass Azure AD auth & inject a mock user */
class MockAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();
    req.user = { 
      id: mockUserId,
      email: 'zachary.padilla@csulb.edu', 
      first_name: 'Zachary', 
      last_name: 'Padilla', 
      user_type: 'STUDENT' 
    };
    return true;
  }
}

describe('ReportsController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let lotCuid: string;

  beforeAll(async () => {
    // Disable throttler globally for test suite, due to combination of APP_GUARD + route override registrations
    ThrottlerGuard.prototype.canActivate = () => Promise.resolve(true);

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
    .overrideGuard(AzureAdGuard).useClass(MockAuthGuard)
    .overrideProvider(AzureAdGuard).useClass(MockAuthGuard)
    .compile();

    app = moduleFixture.createNestApplication();

    bootstrapTestApp(app);
    await app.init();

    prisma = app.get(PrismaService);

    // Get seeded user id
    const zach = await prisma.user.findUnique({ 
      where: { email: 'zachary.padilla@csulb.edu' } 
    });
    if (!zach) throw new Error('Seeded user \'zachary.padilla@csulb.edu\' not found!');
    mockUserId = zach.id;

    // Get seeded lot
    const lot = await prisma.lot.findFirst();
    if (!lot) throw new Error('Test database must have at least one lot seeded.');
    lotCuid = lot.id;
  });

  afterAll(async () => {
    // Test-generated record cleanup
    await prisma.report.deleteMany({ 
      where: { user_id: mockUserId } 
    });
    await app.close();
  });

  describe('/api/v1/reports (POST)', () => {
    it('should create a report with a message', () => {
      return request(app.getHttpServer())
        .post('/api/v1/reports')
        .send({
          lotId: lotCuid,
          type: 'other',
          message: 'I do not like this lot. Delete it immediately.',
        })
        .expect(201)
        .expect((res: Response) => {
          expect(res.body.id).toBeDefined();
          expect(res.body.created_at).toBeDefined();
        });
    });

    it('should create a report without a message', () => {
      return request(app.getHttpServer())
        .post('/api/v1/reports')
        .send({
          lotId: lotCuid,
          type: 'crash',
        })
        .expect(201)
        .expect((res: Response) => {
          expect(res.body.id).toBeDefined();
        });
    });

    it('should return 404 for a non-existent parking lot', () => {
      return request(app.getHttpServer())
        .post('/api/v1/reports')
        .send({
          lotId: 'cm0invalidcuid0000xyz',
          type: 'other',
          message: 'Broken sensor',
        })
        .expect(404)
    });

    it('should reject missing lotId', () => {
      return request(app.getHttpServer())
        .post('/api/v1/reports')
        .send({
          type: 'blockage',
        })
        .expect(400)
    });

    it('should reject missing type', () => {
      return request(app.getHttpServer())
        .post('/api/v1/reports')
        .send({
          lotId: 'cm0invalidcuid0000xyz',
        })
        .expect(400)
    });

    it('should reject invalid incident type', () => {
      return request(app.getHttpServer())
        .post('/api/v1/reports')
        .send({
          lotId: 'cm0invalidcuid0000xyz',
          type: 'SKIPPED_CLASS',
        })
        .expect(400);
    });

    it('should reject unknown fields (forbidNonWhitelisted)', () => {
      return request(app.getHttpServer())
        .post('/api/v1/reports')
        .send({
          lotId: 'cm0invalidcuid0000xyz',
          type: 'blockage',
          adminOverride: true,
        })
        .expect(400);
    });
  });

  describe('/api/v1/reports (POST) — unauthenticated', () => {
    let anonApp: INestApplication;

    beforeAll(async () => {
      const moduleFixture: TestingModule = await Test.createTestingModule({
        imports: [AppModule],
      }).compile();
      anonApp = moduleFixture.createNestApplication();
      bootstrapTestApp(anonApp);
      await anonApp.init();
    });

    afterAll(() => anonApp.close());

    it('should return 401 for anonymous requests', () =>
      request(anonApp.getHttpServer()).post('/api/v1/reports').send({}).expect(401));
  });
});