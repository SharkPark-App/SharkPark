import 'dotenv/config';
// MUST be the first non-builtin import — initializes Sentry before any other
// module is required so its instrumentation hooks attach properly.
import './instrument';
import { NestFactory } from '@nestjs/core';
import { ValidationPipe, Logger } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { API_PREFIX } from './constants';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { IoAdapter } from '@nestjs/platform-socket.io';

async function bootstrap() {
  const isProduction = process.env.NODE_ENV === 'production';

  const app = await NestFactory.create(AppModule, { bufferLogs: true });
  // Use Socket.IO for @WebSocketGateway (shuttle feed)
  app.useWebSocketAdapter(new IoAdapter(app));
  // Swap Nest's default ConsoleLogger for nestjs-pino. JSON in prod, pretty
  // in dev (transport configured in AppModule).
  app.useLogger(app.get(PinoLogger));
  const logger = new Logger('Bootstrap');

  // Security headers. CSP is stricter in production: this is a JSON API, so
  // we disallow all browser-loadable subresources by default.
  app.use(
    helmet({
      contentSecurityPolicy: isProduction
        ? {
            useDefaults: false,
            directives: {
              defaultSrc: ["'none'"],
              frameAncestors: ["'none'"],
              baseUri: ["'none'"],
              formAction: ["'none'"],
            },
          }
        : false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'no-referrer' },
    }),
  );

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

  // Fire OnModuleDestroy / OnApplicationShutdown on SIGTERM/SIGINT so Prisma
  // closes its pg pool cleanly and Fly.io completes graceful shutdowns
  // within its drain window.
  app.enableShutdownHooks();

  const port = process.env.PORT || 3000;
  const host = process.env.HOST || '0.0.0.0';
  await app.listen(port, host);

  // Belt-and-suspenders: explicit signal handlers in case something installs
  // a default handler before us. Nest's enableShutdownHooks also listens.
  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      logger.log(`Received ${signal}, closing app...`);
      void app.close().then(() => process.exit(0));
    });
  }

  logger.log(`SharkPark API running on http://localhost:${port}/${API_PREFIX} [${isProduction ? 'production' : 'development'}]`);
}
void bootstrap();
