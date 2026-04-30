import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';

/**
 * Mirrors the global prefix, exception filter, and ValidationPipe config from
 * src/main.ts. Use this in every e2e beforeAll() block so request-validation
 * behavior in tests matches production exactly. If main.ts changes, update
 * this helper in lockstep.
 */
export function bootstrapTestApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );
}