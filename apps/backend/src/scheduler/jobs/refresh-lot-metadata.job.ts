/**
 * Monthly cron: reconcile EV charger presence from concept3d API with curated
 * lot metadata. Logs discrepancies; does NOT overwrite curated stall counts.
 */
import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';

import { PrismaService } from '../../database/database.module';
import { fetchConcept3dLocations } from '../../lots/concept3d-client';
import { CronRunnerService } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';

const NAME = 'refresh-lot-metadata';
const EV_CAT_IDS = new Set([41613, 77326]);

function lotIdFromMarkerName(name: string): string | null {
  const m1 = name.match(/Lot\s+([A-Z]+\d+)\b/i);
  if (m1) return m1[1].toUpperCase();
  if (/pyramid/i.test(name)) return 'PYR';
  if (/palo verde north/i.test(name)) return 'PVN';
  if (/palo verde south/i.test(name)) return 'PVS';
  return null;
}

@Injectable()
export class RefreshLotMetadataJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async () => {
      const school = await this.prisma.school.findFirst({
        where: { short_name: 'CSULB' },
        select: { id: true },
      });
      if (!school) {
        this.logger.warn(`[${NAME}] no CSULB school row found`);
        return;
      }

      const lots = await this.prisma.lot.findMany({
        where: { school_id: school.id },
        select: { id: true, lot_id: true, ev_charging_stations: true },
      });
      const lotsById = new Map(lots.map((l) => [l.lot_id, l]));

      const items = await fetchConcept3dLocations();
      const evItems = items.filter((i) => EV_CAT_IDS.has(i.catId));
      this.logger.log(`[${NAME}] found ${evItems.length} concept3d EV markers`);

      const presenceByLot = new Map<
        string,
        { markerIds: number[]; markerNames: string[] }
      >();
      for (const item of evItems) {
        const lotId = lotIdFromMarkerName(item.name);
        if (!lotId) {
          this.logger.warn(
            `[${NAME}] could not map EV marker '${item.name}' to lot_id`,
          );
          continue;
        }
        const entry =
          presenceByLot.get(lotId) ?? { markerIds: [], markerNames: [] };
        if (!entry.markerIds.includes(item.id)) entry.markerIds.push(item.id);
        if (!entry.markerNames.includes(item.name))
          entry.markerNames.push(item.name);
        presenceByLot.set(lotId, entry);
      }

      const allLotIds = new Set([
        ...lotsById.keys(),
        ...presenceByLot.keys(),
      ]);
      let errors = 0;
      let warnings = 0;
      for (const lotId of allLotIds) {
        const lot = lotsById.get(lotId);
        const presence = presenceByLot.get(lotId);
        const stalls = lot?.ev_charging_stations ?? null;
        const markers = presence?.markerIds.length ?? 0;
        const inSeed = lot !== undefined;

        if (!inSeed) {
          this.logger.warn(
            `[${NAME}] concept3d EV marker(s) for unknown lot_id ${lotId}`,
          );
          warnings++;
          continue;
        }
        if (markers > 0 && (stalls ?? 0) === 0) {
          this.logger.error(
            `[${NAME}] concept3d shows EV marker(s) for ${lotId} but ev_charging_stations=0`,
          );
          errors++;
          continue;
        }
        if (markers === 0 && (stalls ?? 0) > 0) {
          this.logger.warn(
            `[${NAME}] curated ev_charging_stations=${stalls} for ${lotId} but no concept3d marker`,
          );
          warnings++;
          continue;
        }
        if (markers > 0) {
          this.logger.log(
            `[${NAME}] ${lotId}: curated stalls=${stalls}, concept3d markers=${markers}`,
          );
        }
      }
      this.logger.log(
        `[${NAME}] complete: ${errors} error(s), ${warnings} warning(s)`,
      );
    });
  }
}
