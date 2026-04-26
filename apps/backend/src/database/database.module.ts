import { Module, Global, Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

/**
 * PrismaService wraps @prisma/client for NestJS lifecycle management.
 * Prisma v7 "client" engine requires a driver adapter for direct DB connections.
 *
 * Local  → Docker PostgreSQL 17 on port 5433, no SSL, small pool.
 * Prod   → Neon PostgreSQL 17 (us-west-2), SSL required, pooled connection
 *          via Neon's connection pooler. Pool max kept low (8) because Neon
 *          charges per active connection and the pooler multiplexes for us.
 *
 * Optional: DATABASE_URL_RO can point at a Neon read replica branch for
 * future read-side splitting. Currently exposed via `readPool` but not yet
 * wired into Prisma queries (Prisma v7 doesn't support per-query datasources
 * directly; this is plumbing for a future read-replica adapter).
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly pool: pg.Pool;
  readonly readPool: pg.Pool;
  private readonly hasDedicatedReader: boolean;
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const isProduction = process.env.NODE_ENV === 'production';
    const writeUrl = process.env.DATABASE_URL;
    const readUrl = process.env.DATABASE_URL_RO?.trim() || writeUrl;

    const pool = new pg.Pool({
      connectionString: writeUrl,
      max: isProduction ? 8 : 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ...(isProduction && { ssl: { rejectUnauthorized: true } }),
    });

    const adapter = new PrismaPg(pool);
    super({ adapter });
    this.pool = pool;

    // Reuse the write pool when no separate RO URL is configured to avoid
    // doubling Neon connection cost in dev / single-region prod.
    this.hasDedicatedReader = Boolean(
      process.env.DATABASE_URL_RO && process.env.DATABASE_URL_RO !== writeUrl,
    );
    this.readPool = this.hasDedicatedReader
      ? new pg.Pool({
          connectionString: readUrl,
          max: isProduction ? 8 : 3,
          idleTimeoutMillis: 30_000,
          connectionTimeoutMillis: 5_000,
          ...(isProduction && { ssl: { rejectUnauthorized: true } }),
        })
      : pool;
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log(
      `Database connected (read replica: ${this.hasDedicatedReader ? 'dedicated' : 'shared with primary'})`,
    );
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
    if (this.hasDedicatedReader) {
      await this.readPool.end();
    }
    this.logger.log('Database disconnected');
  }
}

/**
 * Global module providing PrismaService to all feature modules.
 * Replaces the previous DynamoDB client + table-name providers.
 */
@Global()
@Module({
  providers: [PrismaService],
  exports: [PrismaService],
})
export class DatabaseModule {}
