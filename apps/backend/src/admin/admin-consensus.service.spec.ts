import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AdminConsensusService } from './admin-consensus.service';

describe('AdminConsensusService', () => {
  function makePrisma() {
    return {
      lot: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      consensusObservation: {
        findMany: jest.fn(),
      },
    };
  }

  it('rejects malformed dates', async () => {
    const prisma = makePrisma();
    prisma.lot.findUnique.mockResolvedValue({ id: 'l1', lot_id: 'G1' });
    const svc = new AdminConsensusService(prisma as never);
    await expect(svc.getForLotDate('l1', '2026-5-7')).rejects.toThrow(BadRequestException);
    await expect(svc.getForLotDate('l1', 'yesterday')).rejects.toThrow(BadRequestException);
  });

  it('throws NotFound when neither cuid nor lot_id matches', async () => {
    const prisma = makePrisma();
    prisma.lot.findUnique.mockResolvedValue(null);
    prisma.lot.findFirst.mockResolvedValue(null);
    const svc = new AdminConsensusService(prisma as never);
    await expect(svc.getForLotDate('nope', '2026-05-07')).rejects.toThrow(NotFoundException);
  });

  it('falls back to lookup by lot_id code when cuid does not match', async () => {
    const prisma = makePrisma();
    prisma.lot.findUnique.mockResolvedValue(null);
    prisma.lot.findFirst.mockResolvedValue({ id: 'l1', lot_id: 'G1' });
    prisma.consensusObservation.findMany.mockResolvedValue([]);
    const svc = new AdminConsensusService(prisma as never);
    const r = await svc.getForLotDate('G1', '2026-05-07');
    expect(prisma.lot.findFirst).toHaveBeenCalledWith({
      where: { lot_id: 'G1' },
      select: { id: true, lot_id: true },
    });
    expect(r.lotCode).toBe('G1');
    expect(r.count).toBe(0);
    expect(r.groundTruthCount).toBe(0);
  });

  it('queries the full UTC day window and serializes rows', async () => {
    const prisma = makePrisma();
    prisma.lot.findUnique.mockResolvedValue({ id: 'l1', lot_id: 'G1' });
    const start = new Date('2026-05-07T12:00:00.000Z');
    const end = new Date('2026-05-07T12:05:00.000Z');
    const created = new Date('2026-05-07T12:05:30.000Z');
    prisma.consensusObservation.findMany.mockResolvedValue([
      {
        window_start: start,
        window_end: end,
        contributor_count: 5,
        agreement_score: 0.83,
        observed_occupancy: 42,
        observed_rate: 0.42,
        is_ground_truth: true,
        created_at: created,
      },
      {
        window_start: new Date('2026-05-07T12:05:00.000Z'),
        window_end: new Date('2026-05-07T12:10:00.000Z'),
        contributor_count: 1,
        agreement_score: 0.5,
        observed_occupancy: 42,
        observed_rate: 0.42,
        is_ground_truth: false,
        created_at: created,
      },
    ]);
    const svc = new AdminConsensusService(prisma as never);
    const r = await svc.getForLotDate('l1', '2026-05-07');

    expect(prisma.consensusObservation.findMany).toHaveBeenCalledWith({
      where: {
        lot_id: 'l1',
        window_start: {
          gte: new Date('2026-05-07T00:00:00.000Z'),
          lt: new Date('2026-05-08T00:00:00.000Z'),
        },
      },
      orderBy: { window_start: 'asc' },
    });
    expect(r.count).toBe(2);
    expect(r.groundTruthCount).toBe(1);
    expect(r.rows[0].windowStart).toBe(start.toISOString());
    expect(r.rows[0].agreementScore).toBe(0.83);
    expect(r.rows[0].isGroundTruth).toBe(true);
    expect(r.date).toBe('2026-05-07');
  });
});
