import 'dotenv/config';
// MUST be the first non-builtin import — initializes Sentry before any other
// module is required so its instrumentation hooks attach properly.
import './instrument';

import { NestFactory } from '@nestjs/core';
import { Logger } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';
import * as Sentry from '@sentry/nestjs';

import { SchedulerModule } from './scheduler/scheduler.module';

/**
 * Long-running cron host for SharkPark backend.
 *
 * No HTTP server: this process exists solely to hold a NestJS application
 * context whose ScheduleModule has registered every `@Cron(...)` method
 * declared by the *.job.ts classes. Timers fire in-process, sharing a
 * single Prisma pool, Redis client, Firebase Admin instance, etc.
 *
 * Lifecycle:
 *   - SIGTERM/SIGINT → close the Nest context (fires shutdown hooks for
 *     PrismaService, ScheduleRegistry, etc.) → flush Sentry → exit 0.
 *   - Uncaught error inside a tick is captured by CronRunnerService and
 *     re-thrown to the @nestjs/schedule runtime, which logs it but keeps
 *     the timer alive for the next tick.
 *
 * Run on Fly's `cron` process group (see apps/backend/fly.toml):
 *   `node dist/scheduler-main.js`
 */
async function bootstrap() {
  const app = await NestFactory.createApplicationContext(SchedulerModule, {
    bufferLogs: true,
  });
  app.useLogger(app.get(PinoLogger));
  app.enableShutdownHooks();

  const logger = new Logger('SchedulerBootstrap');

  for (const signal of ['SIGTERM', 'SIGINT'] as const) {
    process.once(signal, () => {
      logger.log(`Received ${signal}, shutting down scheduler...`);
      void (async () => {
        try {
          await app.close();
        } catch (err) {
          logger.error(`Error during shutdown: ${(err as Error).message}`);
        }
        await Sentry.flush(2000).catch(() => undefined);
        process.exit(0);
      })();
    });
  }

  logger.log(
    `SharkPark scheduler running [${process.env.NODE_ENV ?? 'development'}]`,
  );
}

void bootstrap();
