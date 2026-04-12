import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe, CanActivate, ExecutionContext } from '@nestjs/common';
import request from 'supertest';
import type { Response } from 'supertest';
import { AppModule } from '../src/app.module';
import { AllExceptionsFilter } from '../src/common/filters/all-exceptions.filter';
import { AuthGuard } from '@nestjs/passport';

/**
 * Azure AD AuthGuard blocks requests w/o valid credentials.
 * This mock extracts the userId from the URL so assertOwner() sees a matching email.
 */
class MockAuthGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const req = context.switchToHttp().getRequest();

    // Extract the userId (email) from the URL path so IDOR checks pass.
    // Routes: /api/v1/users/:userId, /api/v1/users/:userId/favorites, etc.
    const match = req.url.match(/\/users\/([^/]+)/);
    const email = match ? decodeURIComponent(match[1]) : 'test@csulb.edu';

    req.user = {
      email,
      first_name: 'Test',
      last_name: 'User',
      user_type: 'STUDENT'
    };

    return true; // always allow access
  }
}

describe('UsersController (e2e)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    })
    .overrideGuard(AuthGuard('azure-ad'))
    .useClass(MockAuthGuard)
    .compile();

    app = moduleFixture.createNestApplication();
    
    app.setGlobalPrefix('api/v1');
    app.useGlobalFilters(new AllExceptionsFilter());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: false,
        transform: true,
        transformOptions: {
          enableImplicitConversion: true,
        },
      }),
    );

    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  describe('/api/v1/users/:userId (GET)', () => {
    it('should return student user profile with favorites', () => {
      return request(app.getHttpServer())
        .get('/api/v1/users/charles.milton@csulb.edu')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.email).toBe('charles.milton@csulb.edu');
          expect(res.body.data.user_type).toBe('STUDENT');
          expect(res.body.data.first_name).toBe('Charles');
          expect(res.body.data.last_name).toBe('Milton');
          expect(Array.isArray(res.body.data.favorites)).toBe(true);
          expect(res.body.data.favorites.length).toBeGreaterThan(0);
        });
    });

    it('should return employee user profile with favorites', () => {
      return request(app.getHttpServer())
        .get('/api/v1/users/ly.nguyen@csulb.edu')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.data.email).toBe('ly.nguyen@csulb.edu');
          expect(res.body.data.user_type).toBe('EMPLOYEE');
          expect(res.body.data.first_name).toBe('Ly');
          expect(res.body.data.last_name).toBe('Nguyen');
          expect(Array.isArray(res.body.data.favorites)).toBe(true);
        });
    });

    it('should return 404 for non-existent user', () => {
      return request(app.getHttpServer())
        .get('/api/v1/users/nonexistent@csulb.edu')
        .expect(404)
        .expect((res: Response) => {
          expect(res.body.success).toBe(false);
          expect(res.body.message).toContain('not found');
        });
    });
  });

  describe('/api/v1/users/:userId/favorites (GET)', () => {
    it('should return user favorites as array of lot IDs', () => {
      return request(app.getHttpServer())
        .get('/api/v1/users/charles.milton@csulb.edu/favorites')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(Array.isArray(res.body.data)).toBe(true);
          expect(res.body.data.length).toBeGreaterThan(0);
          // Verify it's an array of strings (lot IDs)
          res.body.data.forEach((lotId: string) => {
            expect(typeof lotId).toBe('string');
          });
        });
    });

    it('should return employee favorites (can include both student and employee lots)', () => {
      return request(app.getHttpServer())
        .get('/api/v1/users/ly.nguyen@csulb.edu/favorites')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(Array.isArray(res.body.data)).toBe(true);
          // Ly has favorites across both STUDENT (G) and EMPLOYEE (E) lots
          expect(res.body.data).toContain('E1');
          expect(res.body.data).toContain('G4');
        });
    });
  });

  describe('/api/v1/users/:userId/favorites/:lotId (POST)', () => {
    it('should add a favorite lot', () => {
      return request(app.getHttpServer())
        .post('/api/v1/users/charles.milton@csulb.edu/favorites/G2')
        .expect(201)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.message).toContain('Added');
        });
    });

    it('should allow students to favorite employee lots', () => {
      return request(app.getHttpServer())
        .post('/api/v1/users/charles.milton@csulb.edu/favorites/E1')
        .expect(201)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
        });
    });

    it('should allow employees to favorite student lots', () => {
      return request(app.getHttpServer())
        .post('/api/v1/users/ly.nguyen@csulb.edu/favorites/G9')
        .expect(201)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
        });
    });
  });

  describe('/api/v1/users/:userId/favorites/:lotId (DELETE)', () => {
    it('should remove a favorite lot', () => {
      return request(app.getHttpServer())
        .delete('/api/v1/users/charles.milton@csulb.edu/favorites/G1')
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          expect(res.body.message).toContain('Removed');
        });
    });
  });

  describe('/api/v1/users/:userId/notifications (PATCH)', () => {
    it('should update notification preferences', () => {
      return request(app.getHttpServer())
        .patch('/api/v1/users/charles.milton@csulb.edu/notifications')
        .send({
          favorites_filling: false,
          surge_alerts: true,
        })
        .expect(200)
        .expect((res: Response) => {
          expect(res.body.success).toBe(true);
          // Note: Update endpoint not fully implemented yet, just returns user profile
          expect(res.body.data).toHaveProperty('email');
        });
    });
  });
});
