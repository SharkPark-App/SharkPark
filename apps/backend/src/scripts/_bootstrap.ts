// Sentry must be imported before any other application code so its
// instrumentation is in place by the time the Nest context boots.
import '../instrument';

import { NestFactory } from '@nestjs/core';
import type { INestApplicationContext } from '@nestjs/common';
import { Logger as PinoLogger } from 'nestjs-pino';
import { AppModule } from '../app.module';
import { PrismaService } from '../database/database.module';
import { withAdvisoryLock } from './_advisory-lock';

export interface CronContext {
  app: INestApplicationContext;
  prisma: PrismaService;
  logger: PinoLogger;
}

/**
 * Bootstrap a minimal Nest application context (no HTTP server) suitable for
 * one-shot cron scripts. Returns the running context plus convenience handles
 * to Prisma and the pino logger.
 *
 * Caller is responsible for awaiting `app.close()` when done.
 */
export async function bootstrapCronContext(): Promise<CronContext> {
  const app = await NestFactory.createApplicationContext(AppModule, {
    bufferLogs: true,
  });
  const logger = app.get(PinoLogger);
  app.useLogger(logger);
  app.enableShutdownHooks();
  const prisma = app.get(PrismaService);
  return { app, prisma, logger };
}

/**
 * Standard wrapper for cron scripts: bootstrap context, acquire advisory lock
 * keyed by `jobName`, run `work`, tear down cleanly. Exits the process with
 * code 0 on success or busy-lock, 1 on failure.
 *
 * Use as the script entry point:
 *
 *   void runCronJob('snapshot', async ({ app }) => {
 *     await app.get(MyService).doThing();
 *   });
 */
export async function runCronJob(
  jobName: string,
  work: (ctx: CronContext) => Promise<void>,
): Promise<void> {
  let ctx: CronContext | undefined;
  let exitCode = 0;
  try {
    ctx = await bootstrapCronContext();
    const log = ctx.logger;
    log.log(`[cron:${jobName}] starting`);

    const outcome = await withAdvisoryLock(ctx.prisma.pool, jobName, () =>
      work(ctx as CronContext),
    );

    if (!outcome.acquired) {
      log.log(`[cron:${jobName}] another instance holds the lock — skipping`);
    } else {
      log.log(`[cron:${jobName}] complete`);
    }
  } catch (err) {
    exitCode = 1;
    const message = err instanceof Error ? err.message : String(err);
    const stack = err instanceof Error ? err.stack : undefined;
    if (ctx?.logger) {
      ctx.logger.error(`[cron:${jobName}] failed: ${message}`, stack);
    } else {
      console.error(`[cron:${jobName}] failed before bootstrap:`, err);
    }
  } finally {
    if (ctx?.app) {
      await ctx.app.close().catch(() => undefined);
    }
    process.exit(exitCode);
  }
}
