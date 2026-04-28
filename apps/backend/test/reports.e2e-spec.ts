import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, CanActivate, BadRequestException } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AzureAdGuard } from '../src/auth/azure-ad.guard';

/** Mock guard to bypass Azure AD auth in e2e tests */
class MockAuthGuard implements CanActivate {
  canActivate(): boolean {
    return true;
  }
}

describe('ReportsController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
    .overrideGuard(AzureAdGuard)
    .useClass(MockAuthGuard)
    .overrideProvider(AzureAdGuard)
    .useClass(MockAuthGuard)
    .overrideGuard(ThrottlerGuard)
    .useClass(MockAuthGuard)
    .compile();

    app = moduleFixture.createNestApplication();

    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
        exceptionFactory: (errors) => {
          // Manually extract messages negated by AllExceptionsFilter
          const messages = errors.map(
            (err) => `${err.property}: ${Object.values(err.constraints || {}).join(', ')}`
          );
          return new BadRequestException(messages.join('; '));
        },
        transformOptions: {
          enableImplicitConversion: false,
        },
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/api/v1/reports (POST)', () => {
    it('should create a report with a message', () => {
      return request(app.getHttpServer())
        .post('/api/v1/reports')
        .send({
          lotId: 'G1', // Using a seeded lot from lot-data.ts
          type: 'other',
          message: 'I do not like this lot. Delete it immediately.',
        })
        .expect(201)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
        });
    });

    it('should create a report without a message', () => {
      return request(app.getHttpServer())
        .post('/api/v1/reports')
        .send({
          lotId: 'G1',
          type: 'crash',
        })
        .expect(201)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
        });
    });

    it('should return 404 for a non-existent parking lot', () => {
      return request(app.getHttpServer())
        .post('/api/v1/reports')
        .send({
          lotId: 'INVALID_LOT_999',
          type: 'other',
          message: 'Broken sensor',
        })
        .expect(404)
        .expect((res: Response) => {
          expect(res.body.message).toBe("Parking lot 'INVALID_LOT_999' not found.");
        });
    });

    it('should reject missing lotId', () => {
      return request(app.getHttpServer())
        .post('/api/v1/reports')
        .send({
          type: 'blockage',
        })
        .expect(400)
        .expect((res: Response) => {
          expect(res.body.message).toContain('lotId should not be empty');
        });
    });

    it('should reject missing type', () => {
      return request(app.getHttpServer())
        .post('/api/v1/reports')
        .send({
          lotId: 'G1',
        })
        .expect(400)
        .expect((res: Response) => {
          expect(res.body.message).toContain('type must be one of the following values: blockage, crash, other');
        });
    });

    it('should reject invalid incident type', () => {
      return request(app.getHttpServer())
        .post('/api/v1/reports')
        .send({
          lotId: 'G1',
          type: 'SKIPPED_CLASS',
        })
        .expect(400);
    });

    it('should reject invalid message type (must be string)', () => {
      return request(app.getHttpServer())
        .post('/api/v1/reports')
        .send({
          lotId: 'G1',
          type: 'blockage',
          message: 12345,
        })
        .expect(400);
    });
  });
});