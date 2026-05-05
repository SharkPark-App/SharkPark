import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../database/database.module';
import { hashDeviceId } from '../occupancy-events/utils/privacy.util';

/**
 * Shared freshness check for the Contributor tier.
 *
 * Originally lived inside `ContributorGuard`, but the same check is now also
 * needed by Public endpoints that *redact* live-occupancy fields from
 * non-contributors (instead of 403'ing). Extracting it keeps the two call
 * sites in lockstep — there is exactly one definition of "is this device a
 * contributor right now."
 *
 * A device is considered a current contributor when EITHER:
 *   - its `ContributorPing.last_seen_at` is within `CONTRIBUTOR_PING_TTL_MS`
 *     (default 30 min), OR
 *   - its `granted_at` is within `CONTRIBUTOR_GRANT_TTL_MS` (default 24 h) —
 *     the first-run grace pass that lets a freshly-granted device read
 *     before the first geofence event lands.
 *
 * `isContributor` NEVER throws. It returns false for missing / empty headers,
 * unknown devices, and stale rows. The guard wraps it and translates `false`
 * into `403 BG_LOCATION_REQUIRED`; Public-tier controllers translate `false`
 * into a redacted response.
 */
@Injectable()
export class ContributorService {
  private readonly logger = new Logger(ContributorService.name);
  private readonly pingTtlMs: number;
  private readonly grantTtlMs: number;

  constructor(private readonly prisma: PrismaService) {
    this.pingTtlMs = parsePositiveMs(process.env.CONTRIBUTOR_PING_TTL_MS, 30 * 60 * 1000);
    this.grantTtlMs = parsePositiveMs(process.env.CONTRIBUTOR_GRANT_TTL_MS, 24 * 60 * 60 * 1000);
  }

  /**
   * Returns true iff the device behind `rawDeviceId` is currently a
   * contributor (fresh ping OR fresh grant). Safe to call on every read.
   */
  async isContributor(rawDeviceId: unknown): Promise<boolean> {
    const deviceId = normalizeHeader(rawDeviceId);
    if (!deviceId) return false;

    const deviceHash = hashDeviceId(deviceId);
    const ping = await this.prisma.contributorPing.findUnique({
      where: { device_hash: deviceHash },
      select: { last_seen_at: true, granted_at: true },
    });

    if (!ping) return false;

    const now = Date.now();
    if (now - ping.last_seen_at.getTime() <= this.pingTtlMs) return true;
    if (ping.granted_at && now - ping.granted_at.getTime() <= this.grantTtlMs) return true;
    return false;
  }

  /**
   * Retention prune: delete `contributor_pings` rows that haven't been seen
   * in `idleDays` AND whose grant (if any) is also older than `idleDays`.
   *
   * A `ContributorPing` row stores SHA-256(device_id) — not directly PII,
   * but a stable per-device identifier we should not retain for users who
   * have stopped using the app. The grant column is checked too because a
   * recently re-granted device might not have pinged yet (first-run grace
   * window from `isContributor`).
   *
   * 180 days is chosen so a college user who skips the entire summer
   * (typical May–Aug recess ≈ 4 months) is not pruned and re-prompted in
   * Fall semester. Anything shorter would force re-onboarding for the
   * common student pattern.
   */
  async pruneIdlePings(
    idleDays: number = 180,
  ): Promise<{ pings_deleted: number; cutoff: string }> {
    if (!Number.isFinite(idleDays) || idleDays < 1) {
      throw new Error(
        `pruneIdlePings: idleDays must be >= 1, got ${idleDays}`,
      );
    }
    const cutoff = new Date(Date.now() - idleDays * 24 * 60 * 60 * 1000);
    const { count } = await this.prisma.contributorPing.deleteMany({
      where: {
        last_seen_at: { lt: cutoff },
        OR: [{ granted_at: null }, { granted_at: { lt: cutoff } }],
      },
    });
    this.logger.log(
      `[retention] Pruned ${count} contributor_pings idle since ${cutoff.toISOString()} (idleDays=${idleDays})`,
    );
    return { pings_deleted: count, cutoff: cutoff.toISOString() };
  }
}

/**
 * Mirrors the header-parsing behavior the guard relied on:
 * - Array (proxy chain) → first value.
 * - Non-string → null.
 * - Empty / whitespace → null.
 */
function normalizeHeader(raw: unknown): string | null {
  const value = Array.isArray(raw) ? raw[0] : raw;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function parsePositiveMs(raw: string | undefined, fallback: number): number {
  const parsed = raw ? Number(raw) : NaN;
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}
