import { Injectable } from '@nestjs/common';
import { PrismaService } from './database/database.module';
import { SERVICE_NAME } from './constants';

@Injectable()
export class AppService {
  constructor(private readonly prisma: PrismaService) {}

  async getHealth() {
    let dbOk = false;
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      dbOk = true;
    } catch {
      dbOk = false;
    }

    return {
      ok: dbOk,
      service: SERVICE_NAME,
      database: dbOk ? 'connected' : 'unreachable',
      timestamp: new Date().toISOString(),
    };
  }
}
