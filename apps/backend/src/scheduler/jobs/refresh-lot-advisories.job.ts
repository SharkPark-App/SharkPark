/**
 * Weekly cron: refresh `lot_advisories` from the live concept3d API.
 * See seed-prod.ts section-5 for the dev-seed equivalent.
 */
import type { Prisma } from '@prisma/client';

import { Injectable } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { Logger as PinoLogger } from 'nestjs-pino';

import { PrismaService } from '../../database/database.module';
import { fetchConcept3dLocations } from '../../lots/concept3d-client';
import {
  extractLotAdvisories,
  type LatLng,
  type LotPolygon,
} from '../../lots/lot-advisory-extractor';
import { CronRunnerService } from '../cron-runner.service';
import { CRON_MONITORS, CRON_TIMEZONE } from '../cron-monitors';

const NAME = 'refresh-lot-advisories';

@Injectable()
export class RefreshLotAdvisoriesJob {
  constructor(
    private readonly runner: CronRunnerService,
    private readonly prisma: PrismaService,
    private readonly logger: PinoLogger,
  ) {}

  @Cron(CRON_MONITORS[NAME].schedule, { name: NAME, timeZone: CRON_TIMEZONE })
  async handle(): Promise<void> {
    await this.runner.run(NAME, async () => {
      const schools = await this.prisma.school.findMany({
        where: { short_name: 'CSULB' },
        select: { id: true, short_name: true },
      });
      if (schools.length === 0) {
        this.logger.warn(`[${NAME}] no eligible schools — nothing to do`);
        return;
      }

      const items = await fetchConcept3dLocations();
      this.logger.log(`[${NAME}] fetched ${items.length} concept3d locations`);

      for (const school of schools) {
        const lots = await this.prisma.lot.findMany({
          where: { school_id: school.id },
          select: { id: true, lot_id: true, geofence_polygon: true },
        });

        const lotPolygons: LotPolygon[] = lots.map((l) => ({
          lot_id: l.lot_id,
          polygon: l.geofence_polygon as unknown as LatLng[],
        }));
        const lotIdToCuid = new Map(lots.map((l) => [l.lot_id, l.id]));

        const { seeds, stats } = extractLotAdvisories(items, lotPolygons);
        this.logger.log(
          `[${NAME}] ${school.short_name}: ${stats.candidateCount} ` +
            `concept3d candidates → ${seeds.length} seed rows from ${stats.markerCount} markers`,
        );

        const deactivated = await this.prisma.lotAdvisory.updateMany({
          where: { school_id: school.id, source: 'CONCEPT3D', is_active: true },
          data: { is_active: false },
        });
        this.logger.log(
          `[${NAME}] ${school.short_name}: deactivated ` +
            `${deactivated.count} prior CONCEPT3D advisory row(s)`,
        );

        let upserted = 0;
        let skipped = 0;
        for (const seed of seeds) {
          const dbLotId = lotIdToCuid.get(seed.lot_id);
          if (!dbLotId) {
            skipped++;
            continue;
          }
          const polygon = seed.polygon as unknown as Prisma.InputJsonValue;
          await this.prisma.lotAdvisory.upsert({
            where: {
              uq_lot_advisory_source_lot: {
                school_id: school.id,
                source: 'CONCEPT3D',
                source_marker_id: seed.source_marker_id,
                lot_id: dbLotId,
              },
            },
            create: {
              school_id: school.id,
              lot_id: dbLotId,
              title: seed.title,
              description: seed.description,
              severity: seed.severity,
              source: 'CONCEPT3D',
              source_cat_id: seed.source_cat_id,
              source_marker_id: seed.source_marker_id,
              match_reason: seed.match_reason,
              polygon,
              is_active: true,
            },
            update: {
              title: seed.title,
              description: seed.description,
              severity: seed.severity,
              source_cat_id: seed.source_cat_id,
              match_reason: seed.match_reason,
              polygon,
              is_active: true,
            },
          });
          upserted++;
        }

        this.logger.log(
          `[${NAME}] ${school.short_name}: upserted ${upserted} active ` +
            `advisor${upserted === 1 ? 'y' : 'ies'}` +
            (skipped ? ` (${skipped} skipped — unknown lot_id)` : ''),
        );
      }
    });
  }
}
