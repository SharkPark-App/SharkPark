import { Module, Global, Injectable, OnModuleInit, OnModuleDestroy, Logger } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';
import { PrismaPg } from '@prisma/adapter-pg';
import pg from 'pg';

/**
 * PrismaService wraps @prisma/client for NestJS lifecycle management.
 * Prisma v7 "client" engine requires a driver adapter for direct DB connections.
 *
 * Local  → Docker PostgreSQL 16 on port 5433, no SSL, small pool.
 * Prod   → Aurora PostgreSQL Serverless v2, SSL required, larger pool.
 *
 * Switch is automatic via NODE_ENV + DATABASE_URL.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  private readonly pool: pg.Pool;
  private readonly logger = new Logger(PrismaService.name);

  constructor() {
    const isProduction = process.env.NODE_ENV === 'production';

    const pool = new pg.Pool({
      connectionString: process.env.DATABASE_URL,
      max: isProduction ? 20 : 5,
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
      ...(isProduction && { ssl: { rejectUnauthorized: true } }),
    });

    const adapter = new PrismaPg(pool);
    super({ adapter });
    this.pool = pool;
  }

  async onModuleInit() {
    await this.$connect();
    this.logger.log('Database connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    await this.pool.end();
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
