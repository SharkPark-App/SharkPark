import { INestApplication, ValidationPipe } from '@nestjs/common';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';

/**
 * Replicates the exact global middleware, filters, and pipes used in main.ts
 * Use this in all e2e beforeAll() blocks to prevent drift
 */
export function bootstrapTestApp(app: INestApplication): void {
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());
  
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: false,
      transform: true,
      transformOptions: {
        enableImplicitConversion: false, 
      },
    }),
  );
}