import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { PrismaService } from '../database/database.module';
import { hashDeviceId } from '../occupancy-events/utils/privacy.util';

/**
 * Reciprocity gate: a request can read live-occupancy / forecast data only if
 * the device behind it is *currently contributing* occupancy events. The
 * client identifies itself with the `x-device-id` header (same opaque
 * identifier it uses in POST /occupancy-events). The header is hashed
 * server-side with the same SHA-256(DEVICE_HASH_SALT:device_id) used for
 * event storage, so we never see the raw device id.
 *
 * Failure modes (kept distinct so the mobile client can map them to UX):
 *   - missing header  → 403 { code: 'BG_LOCATION_REQUIRED' }
 *   - empty header    → 403 { code: 'BG_LOCATION_REQUIRED' }
 *   - no recent ping  → 403 { code: 'BG_LOCATION_REQUIRED' }
 *
 * "Recent" is currently 30 minutes — a device that hasn't pinged in 30 min
 * is assumed to have stopped contributing (app force-quit, location revoked,
 * device offline). Tunable via CONTRIBUTOR_PING_TTL_MS.
 *
 * This guard is opt-in per controller/handler with @UseGuards(ContributorGuard);
 * it does NOT replace AzureAdGuard. Endpoints that are also auth-gated will
 * stack both guards.
 */
@Injectable()
export class ContributorGuard implements CanActivate {
  private readonly logger = new Logger(ContributorGuard.name);
  private readonly pingTtlMs: number;

  constructor(private readonly prisma: PrismaService) {
    const raw = process.env.CONTRIBUTOR_PING_TTL_MS;
    const parsed = raw ? Number(raw) : NaN;
    this.pingTtlMs = Number.isFinite(parsed) && parsed > 0 ? parsed : 30 * 60 * 1000;
  }

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const req = context.switchToHttp().getRequest<{ headers: Record<string, string | string[] | undefined> }>();
    const rawHeader = req.headers['x-device-id'];
    const deviceId = Array.isArray(rawHeader) ? rawHeader[0] : rawHeader;

    if (!deviceId || typeof deviceId !== 'string' || deviceId.trim().length === 0) {
      throw new ForbiddenException({
        code: 'BG_LOCATION_REQUIRED',
        message:
          'This endpoint requires an active contributor device. Send the x-device-id header and ensure the device has posted a recent occupancy event.',
      });
    }

    const deviceHash = hashDeviceId(deviceId.trim());
    const ping = await this.prisma.contributorPing.findUnique({
      where: { device_hash: deviceHash },
      select: { last_seen_at: true },
    });

    if (!ping) {
      throw new ForbiddenException({
        code: 'BG_LOCATION_REQUIRED',
        message: 'Device has not contributed any occupancy events yet.',
      });
    }

    const ageMs = Date.now() - ping.last_seen_at.getTime();
    if (ageMs > this.pingTtlMs) {
      throw new ForbiddenException({
        code: 'BG_LOCATION_REQUIRED',
        message: 'Device contribution is stale; resume background location to refresh.',
      });
    }

    return true;
  }
}
