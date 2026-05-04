import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/database.module';
import type { CampusEvent } from '@prisma/client';

@Injectable()
export class EventsService {
  constructor(private readonly prisma: PrismaService) {}

  /** Upcoming events for a specific lot, matched via the lot's linked buildings */
  async getEventsForLot(lotId: string): Promise<CampusEvent[]> {
    const lot = await this.prisma.lot.findFirst({
      where: { lot_id: lotId.toUpperCase() },
      select: {
        lot_buildings: { select: { building_id: true } },
      },
    });

    if (!lot || !lot.lot_buildings.length) return [];

    const buildingIds = lot.lot_buildings.map(lb => lb.building_id);
    const now = new Date();
    const windowEnd = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000); // next 7 days

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
    const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
    const result = await this.prisma.campusEvent.deleteMany({
      where: { end_time: { lt: cutoff } },
    });
    return { events_deleted: result.count, cutoff };
  }
}
