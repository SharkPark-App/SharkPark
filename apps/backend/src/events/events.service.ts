import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaService } from '../database/database.module';
import type { CampusEvent, SportsEventStatus, SportsResultStatus } from '@prisma/client';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;

/** Default lookahead window for `getEventsForLot` (preserves the historical 7-day behaviour). */
export const DEFAULT_EVENTS_WINDOW_HOURS = 24 * 7;
/** Hard cap on any caller-supplied lookahead window. Matches the longest forecast horizon. */
export const MAX_EVENTS_WINDOW_HOURS = 24 * 7;

/** Per-lot row in the bulk summary response. */
export interface LotEventsSummary {
  lot_id: string;
  count: number;
  /**
   * Soonest upcoming event in the window, or `null` if `count === 0`.
   *
   * `status` / `home_score` / `away_score` / `result_status` are populated
   * only for sports events ingested by the Sidearm scraper — they are `null`
   * for CampusLabs (academic / club) events. The mobile UI shows a LIVE
   * badge + scoreline when `status === 'LIVE'` or `'FINAL'`.
   */
  next_event: {
    id: string;
    event_name: string;
    location: string;
    start_time: Date;
    end_time: Date;
    status: SportsEventStatus | null;
    home_score: number | null;
    away_score: number | null;
    result_status: SportsResultStatus | null;
  } | null;
}

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
        end_time: { gte: now },
      },
      orderBy: { start_time: 'asc' },
    });
  }

  /**
   * Bulk per-lot upcoming-event counts. One DB round trip (vs N round trips
   * for per-lot fetches) — designed for the mobile map screen, which renders
   * a badge on every visible pin.
   *
   * Returns one row per lot, including lots with `count: 0`, so the caller
   * can render badges without a second "which lots exist?" lookup.
   *
   * Single-school assumption matches `LotsService.findAll`; if/when the
   * deployment grows to multiple schools, add a `schoolShortName` filter
   * here in lockstep.
   */
  async getEventsSummary(
    withinHours?: number,
  ): Promise<LotEventsSummary[]> {
    const hours = this.resolveWindowHours(withinHours);
    const now = new Date();
    const windowEnd = new Date(now.getTime() + hours * HOUR_MS);

    // Pull every lot plus its linked buildings' upcoming events in a single
    // query. We fetch lightweight event fields (not a SQL COUNT) because we
    // also need the soonest event for the badge tooltip; the payload is
    // bounded (~28 lots × a handful of events) so this is cheaper than two
    // round trips.
    const lots = await this.prisma.lot.findMany({
      select: {
        lot_id: true,
        lot_buildings: {
          select: {
            building: {
              select: {
                campus_events: {
                  where: {
                    start_time: { lte: windowEnd },
                    end_time: { gte: now },
                  },
                  select: {
                    id: true,
                    event_name: true,
                    location: true,
                    start_time: true,
                    end_time: true,
                    status: true,
                    home_score: true,
                    away_score: true,
                    result_status: true,
                  },
                  orderBy: { start_time: 'asc' },
                },
              },
            },
          },
        },
      },
      orderBy: { lot_id: 'asc' },
    });

    return lots.map((lot) => {
      // Dedupe across buildings — the same event can be linked to multiple
      // buildings of the same lot (rare, but possible after the polygon-edge
      // upgrade puts e.g. Pyramid into 6 lots' join sets simultaneously).
      const seen = new Map<string, LotEventsSummary['next_event']>();
      for (const lb of lot.lot_buildings) {
        for (const ev of lb.building.campus_events) {
          if (!seen.has(ev.id)) seen.set(ev.id, ev);
        }
      }
      const events = Array.from(seen.values()).filter(
        (e): e is NonNullable<typeof e> => e !== null,
      );
      events.sort((a, b) => a.start_time.getTime() - b.start_time.getTime());
      return {
        lot_id: lot.lot_id,
        count: events.length,
        next_event: events[0] ?? null,
      };
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
    const result = await this.prisma.campusEvent.deleteMany({
      where: { end_time: { lt: cutoff } },
    });
    return { events_deleted: result.count, cutoff };
  }
}
