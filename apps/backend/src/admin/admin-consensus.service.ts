import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';

import { PrismaService } from '../database/database.module';

export interface ConsensusObservationDto {
  windowStart: string;
  windowEnd: string;
  contributorCount: number;
  agreementScore: number;
  observedOccupancy: number;
  observedRate: number;
  isGroundTruth: boolean;
  createdAt: string;
}

export interface AdminConsensusResponse {
  lotId: string;
  lotCode: string;
  date: string;
  count: number;
  groundTruthCount: number;
  rows: ConsensusObservationDto[];
}

/**
 * Read-only operator view over `consensus_observations`.
 *
 * Backs `GET /admin/consensus/:lotId?date=YYYY-MM-DD`. Designed for
 * spot-checking the consensus pipeline output during demos and after
 * the B3 backfill — NOT a public API. Device hashes never leave the
 * backend; the response intentionally omits per-event detail.
 *
 * `lotId` accepts either the cuid PK (`Lot.id`) or the human-readable
 * `lot_id` code (e.g. "G1") to match how operators read fly logs.
 */
@Injectable()
export class AdminConsensusService {
  constructor(private readonly prisma: PrismaService) {}

  async getForLotDate(lotIdParam: string, dateParam: string): Promise<AdminConsensusResponse> {
    const date = parseUtcDate(dateParam);
    const dayStart = new Date(`${dateParam}T00:00:00.000Z`);
    const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60 * 1000);

    const lot = await this.resolveLot(lotIdParam);
    if (lot === null) {
      throw new NotFoundException(`No lot found matching "${lotIdParam}"`);
    }

    const rows = await this.prisma.consensusObservation.findMany({
      where: {
        lot_id: lot.id,
        window_start: { gte: dayStart, lt: dayEnd },
      },
      orderBy: { window_start: 'asc' },
    });

    return {
      lotId: lot.id,
      lotCode: lot.lot_id,
      date: date.toISOString().slice(0, 10),
      count: rows.length,
      groundTruthCount: rows.reduce((acc, r) => acc + (r.is_ground_truth ? 1 : 0), 0),
      rows: rows.map((r) => ({
        windowStart: r.window_start.toISOString(),
        windowEnd: r.window_end.toISOString(),
        contributorCount: r.contributor_count,
        agreementScore: r.agreement_score,
        observedOccupancy: r.observed_occupancy,
        observedRate: r.observed_rate,
        isGroundTruth: r.is_ground_truth,
        createdAt: r.created_at.toISOString(),
      })),
    };
  }

  /** Tries cuid PK first, then the human-readable lot_id code. */
  private async resolveLot(
    param: string,
  ): Promise<{ id: string; lot_id: string } | null> {
    const byPk = await this.prisma.lot.findUnique({
      where: { id: param },
      select: { id: true, lot_id: true },
    });
    if (byPk) return byPk;
    return this.prisma.lot.findFirst({
      where: { lot_id: param },
      select: { id: true, lot_id: true },
    });
  }
}

function parseUtcDate(raw: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(raw)) {
    throw new BadRequestException(
      `Expected date as YYYY-MM-DD, got "${raw}"`,
    );
  }
  const d = new Date(`${raw}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new BadRequestException(`Invalid calendar date "${raw}"`);
  }
  return d;
}
