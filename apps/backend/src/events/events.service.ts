import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/database.module';
import type { CampusEvent } from '@prisma/client';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Default lookahead window for `getEventsForLot` (preserves the historical 7-day behaviour). */
export const DEFAULT_EVENTS_WINDOW_HOURS = 24 * 7;
/** Hard cap on any caller-supplied lookahead window. Matches the longest forecast horizon. */
export const MAX_EVENTS_WINDOW_HOURS = 24 * 7;

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Validate + clamp a caller-supplied `within_hours` value. Throws on
   * non-finite / out-of-range input rather than silently coercing — callers
   * are expected to validate at the controller boundary, so reaching the
   * service with a bad value indicates a bug in the caller.
   */
  private resolveWindowHours(withinHours: number | undefined): number {
    if (withinHours === undefined) return DEFAULT_EVENTS_WINDOW_HOURS;
    if (!Number.isFinite(withinHours) || withinHours < 1) {
      throw new BadRequestException(
        `within_hours must be a finite number >= 1, got ${withinHours}`,
      );
    }
    if (withinHours > MAX_EVENTS_WINDOW_HOURS) {
      throw new BadRequestException(
        `within_hours must be <= ${MAX_EVENTS_WINDOW_HOURS}, got ${withinHours}`,
      );
    }
    return withinHours;
  }

  /**
   * Upcoming events for a single lot, matched server-side via the lot's
   * linked buildings. The window is `[now, now + withinHours)` and an event
   * is included when it overlaps that window at all (started but not yet
   * ended also counts).
   */
  async getEventsForLot(
    lotId: string,
    withinHours?: number,
  ): Promise<CampusEvent[]> {
    const hours = this.resolveWindowHours(withinHours);

    const lot = await this.prisma.lot.findFirst({
      where: { lot_id: lotId.toUpperCase() },
      select: {
        lot_buildings: { select: { building_id: true } },
      },
    });

    if (!lot || !lot.lot_buildings.length) return [];

    const buildingIds = lot.lot_buildings.map(lb => lb.building_id);
    const now = new Date();
    const windowEnd = new Date(now.getTime() + hours * HOUR_MS);

    return this.prisma.campusEvent.findMany({
      where: {
        building_id: { in: buildingIds },
        start_time: { lte: windowEnd },
        // Sports events scraped from Sidearm have null end_time until the
        // FINAL-score refresh stamps a real one (see
        // sports-events-scraper.service.ts). Treat null as "still ongoing /
        // undetermined" so an in-progress game stays surfaced; the refresh
        // cron will set end_time within ~30min of the box score posting,
        // bounding how long a finished game lingers in the feed.
        OR: [
          { end_time: null },
          { end_time: { gte: now } },
        ],
      },
      orderBy: { start_time: 'asc' },
    });
  }

  /**
   * Delete `campus_events` rows whose `end_time` is older than
   * `retentionDays` ago. Intended for the weekly `prune-old-events` cron.
   *
   * Past events are never surfaced by the API (`getEventsForLot` filters
   * `end_time >= now`) and have no live FK consumers — pruning is purely
   * housekeeping to keep the table + nightly backups small.
   */
  async pruneOldEvents(
    retentionDays: number,
    now: Date = new Date(),
  ): Promise<{ events_deleted: number; cutoff: Date }> {
    if (!Number.isFinite(retentionDays) || retentionDays < 1) {
      throw new Error(
        `retentionDays must be a finite number >= 1, got ${retentionDays}`,
      );
    }
    const cutoff = new Date(now.getTime() - retentionDays * DAY_MS);
    // Prune by end_time when present; otherwise fall back to start_time so
    // never-finalized sports rows (e.g. cancelled-then-orphaned games where
    // the box score never published) still get cleaned up.
    const result = await this.prisma.campusEvent.deleteMany({
      where: {
        OR: [
          { end_time: { lt: cutoff } },
          { AND: [{ end_time: null }, { start_time: { lt: cutoff } }] },
        ],
      },
    });
    return { events_deleted: result.count, cutoff };
  }
}
