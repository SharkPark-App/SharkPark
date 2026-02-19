import 'dotenv/config';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { API_PREFIX } from './constants';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const logger = new Logger('Bootstrap');
  const isProduction = process.env.NODE_ENV === 'production';

  const app = await NestFactory.create(AppModule);

  // Security headers (XSS, content-type sniffing, clickjacking, etc.)
  app.use(helmet());

  app.setGlobalPrefix(API_PREFIX);

  // CORS: restrict origins in production, allow all in dev
  app.enableCors({
    origin: isProduction
      ? (process.env.CORS_ORIGINS || '').split(',').map((o) => o.trim()).filter(Boolean)
      : true,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'DELETE'],
  });

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

  const port = process.env.PORT || 3000;
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);

  logger.log(`SharkPark API running on http://localhost:${port}/${API_PREFIX} [${isProduction ? 'production' : 'development'}]`);
}
bootstrap();
