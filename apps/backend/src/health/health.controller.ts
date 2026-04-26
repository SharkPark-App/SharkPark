import { Controller, Get } from '@nestjs/common';
import { HealthCheckService, MemoryHealthIndicator } from '@nestjs/terminus';
import { SkipThrottle } from '@nestjs/throttler';
import { PrismaHealthIndicator } from './prisma.health';
import { Public } from '../auth/public.decorator';

/**
 * /health/live  — Process is up. No external deps. Used by Fly.io for
 *                 liveness checks (restart on failure).
 * /health/ready — Process can serve traffic (DB reachable, memory ok).
 *                 Used by load balancers / Better Stack uptime monitor.
 * /health       — Legacy alias for /health/ready (kept for back-compat).
 */
@Public()
@Controller('health')
@SkipThrottle()
export class HealthController {
  constructor(
    private readonly health: HealthCheckService,
    private readonly memory: MemoryHealthIndicator,
    private readonly prismaHealth: PrismaHealthIndicator,
  ) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  ready() {
    return this.health.check([
      () => this.prismaHealth.isHealthy('database'),
      () => this.memory.checkHeap('memory_heap', 200 * 1024 * 1024), // 200 MB
    ]);
  }

  @Get()
  check() {
    return this.ready();
  }
}
