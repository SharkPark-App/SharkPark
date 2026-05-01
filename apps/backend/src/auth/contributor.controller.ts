import { Controller, HttpCode, HttpStatus, Post, Req, ForbiddenException, Logger } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import type { Request } from 'express';
import { PrismaService } from '../database/database.module';
import { hashDeviceId } from '../occupancy-events/utils/privacy.util';
import { Public } from './public.decorator';

/**
 * Records a permission-grant grace pass for the calling device.
 *
 * Flow:
 *   1. Mobile reaches the "Allow" terminal step in LocationPermissionScreen
 *      (or app boot finds permission already granted).
 *   2. Mobile POSTs to /contributor/grant with no body — the only thing that
 *      matters is the `x-device-id` header that every request already sends.
 *   3. We upsert a ContributorPing row with `granted_at = now()`.
 *   4. ContributorGuard accepts subsequent reads for the next
 *      CONTRIBUTOR_GRANT_TTL_MS (default 24h) even if the device hasn't
 *      produced a real occupancy event yet.
 *
 * This solves the cold-start chicken-and-egg problem (and Apple App Review
 * 5.1.1, which forbids gating value behind a permission demand) without
 * giving away unlimited free reads — the grant expires unless the device
 * starts contributing real data.
 */
@Public()
@Controller('contributor')
export class ContributorController {
  private readonly logger = new Logger(ContributorController.name);

  constructor(private readonly prisma: PrismaService) {}

  @Post('grant')
  // Tight rate limit — this should fire at most a couple of times per device
  // per day (initial grant + occasional refresh on app cold start).
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  async registerGrant(@Req() req: Request): Promise<void> {
    const rawHeader = req.headers['x-device-id'];
    const deviceId = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (!deviceId || typeof deviceId !== 'string' || deviceId.trim().length === 0) {
      // Mirror ContributorGuard's failure shape so the mobile client can
      // route this through the same BG_LOCATION_REQUIRED handler.
      throw new ForbiddenException({
        code: 'BG_LOCATION_REQUIRED',
        message: 'x-device-id header is required to register a permission grant.',
      });
    }

    const deviceHash = hashDeviceId(deviceId.trim());
    const now = new Date();

    await this.prisma.contributorPing.upsert({
      where: { device_hash: deviceHash },
      update: { granted_at: now },
      // first_seen_at/last_seen_at default to now() — last_seen_at is *not*
      // a real contribution event yet, so the guard must keep relying on
      // OccupancyEventsService.create() to bump it on actual writes. We
      // intentionally do not pre-warm last_seen_at here.
      create: { device_hash: deviceHash, granted_at: now },
    });
  }

  /**
   * Revokes the device's contributor status immediately.
   *
   * Mobile calls this when it detects that background-location permission
   * has been revoked (Settings → Privacy → Location toggled off, or the
   * SDK reports `Denied`). Without this, the server would continue
   * serving live data for up to CONTRIBUTOR_GRANT_TTL_MS (24h) after the
   * user revoked permission — because we have no way of knowing the
   * device state has changed otherwise.
   *
   * Implementation: clear `granted_at` AND backdate `last_seen_at` past
   * the ping TTL so neither freshness check passes. We don't delete the
   * row — keeping it preserves the audit trail of past contributions and
   * lets a re-grant naturally re-upsert.
   *
   * Returns 204 even if the device was never known to us (idempotent).
   */
  @Post('revoke')
  @Throttle({ default: { ttl: 60_000, limit: 10 } })
  @HttpCode(HttpStatus.NO_CONTENT)
  async revokeGrant(@Req() req: Request): Promise<void> {
    const rawHeader = req.headers['x-device-id'];
    const deviceId = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (!deviceId || typeof deviceId !== 'string' || deviceId.trim().length === 0) {
      // No device id → nothing to revoke. 204 no-op (matches the idempotent
      // contract; we don't want client retry storms on missing-header bugs).
      return;
    }

    const deviceHash = hashDeviceId(deviceId.trim());
    // Backdate well past CONTRIBUTOR_PING_TTL_MS (default 30min) so the
    // ping freshness check fails immediately. Using epoch keeps the
    // semantics obvious in the database.
    const epoch = new Date(0);

    await this.prisma.contributorPing.updateMany({
      where: { device_hash: deviceHash },
      data: { granted_at: null, last_seen_at: epoch },
    });
  }
}
