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
}
