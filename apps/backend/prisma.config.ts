import 'dotenv/config';
import { defineConfig } from 'prisma/config';

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'ts-node --compiler-options {"module":"CommonJS"} prisma/seed.ts',
  },
  datasource: {
    // Prefer DIRECT_URL for `prisma migrate deploy` (Neon's pgbouncer pooler
    // doesn't support advisory locks / DDL reliably). Fall back to DATABASE_URL
    // for local dev where DIRECT_URL is usually unset.
    url:
      process.env.DIRECT_URL ??
      process.env.DATABASE_URL ??
      'postgresql://sharkpark:sharkpark@localhost:5433/sharkpark?schema=public',
  },
});
