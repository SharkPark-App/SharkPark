import { BadRequestException, NotFoundException } from '@nestjs/common';

import { AdminPenetrationRateService } from './admin-penetration-rate.service';

describe('AdminPenetrationRateService', () => {
  const ENV_FLAG = 'PENETRATION_RATE_LEARNING_ENABLED';
  const originalFlag = process.env[ENV_FLAG];

  afterEach(() => {
    if (originalFlag === undefined) delete process.env[ENV_FLAG];
    else process.env[ENV_FLAG] = originalFlag;
  });

  function makePrisma() {
    return {
      lot: {
        findUnique: jest.fn(),
        findFirst: jest.fn(),
      },
      penetrationRateEstimate: {
        findMany: jest.fn(),
      },
    };
  }

  it('rejects empty lotId', async () => {
    const svc = new AdminPenetrationRateService(makePrisma() as never);
    await expect(svc.getForLot('')).rejects.toThrow(BadRequestException);
  });

  it('throws NotFound when neither cuid nor lot_id matches', async () => {
    const prisma = makePrisma();
    prisma.lot.findUnique.mockResolvedValue(null);
    prisma.lot.findFirst.mockResolvedValue(null);
    const svc = new AdminPenetrationRateService(prisma as never);
    await expect(svc.getForLot('nope')).rejects.toThrow(NotFoundException);
  });

  it('falls back to lookup by lot_id code when cuid does not match', async () => {
    const prisma = makePrisma();
    prisma.lot.findUnique.mockResolvedValue(null);
    prisma.lot.findFirst.mockResolvedValue({ id: 'l1', lot_id: 'G1' });
    prisma.penetrationRateEstimate.findMany.mockResolvedValue([]);
    const svc = new AdminPenetrationRateService(prisma as never);
    const r = await svc.getForLot('G1');
    expect(prisma.lot.findFirst).toHaveBeenCalledWith({
      where: { lot_id: 'G1' },
      select: { id: true, lot_id: true },
    });
    expect(r.lotCode).toBe('G1');
    expect(r.totalBuckets).toBe(0);
    expect(r.blendableBuckets).toBe(0);
  });

  it('reflects the runtime feature flag in the response', async () => {
    const prisma = makePrisma();
    prisma.lot.findUnique.mockResolvedValue({ id: 'l1', lot_id: 'G1' });
    prisma.penetrationRateEstimate.findMany.mockResolvedValue([]);
    const svc = new AdminPenetrationRateService(prisma as never);

    delete process.env[ENV_FLAG];
    expect((await svc.getForLot('l1')).flagEnabled).toBe(false);

    process.env[ENV_FLAG] = 'true';
    expect((await svc.getForLot('l1')).flagEnabled).toBe(true);
  });

  it('exposes constant blending thresholds', async () => {
    const prisma = makePrisma();
    prisma.lot.findUnique.mockResolvedValue({ id: 'l1', lot_id: 'G1' });
    prisma.penetrationRateEstimate.findMany.mockResolvedValue([]);
    const svc = new AdminPenetrationRateService(prisma as never);
    const r = await svc.getForLot('l1');
    expect(r.thresholds).toEqual({
      blendWeight: 0.7,
      minSampleCount: 30,
      freshnessDays: 14,
    });
  });

  it('classifies fresh + well-sampled cells as blendable', async () => {
    const prisma = makePrisma();
    prisma.lot.findUnique.mockResolvedValue({ id: 'l1', lot_id: 'G1' });
    const now = Date.now();
    prisma.penetrationRateEstimate.findMany.mockResolvedValue([
      // Fresh + well-sampled → willBlend = true
      {
        dow_bucket: 0,
        hour_bucket: 10,
        ewma_value: 0.4567891,
        ewma_variance: 0.001234567,
        sample_count: 100,
        last_updated: new Date(now - 1 * 24 * 60 * 60 * 1000),
      },
      // Stale (15 days) → willBlend = false
      {
        dow_bucket: 0,
        hour_bucket: 11,
        ewma_value: 0.5,
        ewma_variance: 0.001,
        sample_count: 100,
        last_updated: new Date(now - 15 * 24 * 60 * 60 * 1000),
      },
      // Undersampled → willBlend = false
      {
        dow_bucket: 1,
        hour_bucket: 12,
        ewma_value: 0.3,
        ewma_variance: 0.001,
        sample_count: 5,
        last_updated: new Date(now),
      },
      // Sat bucket fresh + well-sampled
      {
        dow_bucket: 1,
        hour_bucket: 14,
        ewma_value: 0.2,
        ewma_variance: 0.001,
        sample_count: 50,
        last_updated: new Date(now),
      },
    ]);
    const svc = new AdminPenetrationRateService(prisma as never);
    const r = await svc.getForLot('l1');

    expect(r.totalBuckets).toBe(4);
    expect(r.blendableBuckets).toBe(2);

    const cells = Object.fromEntries(
      r.buckets.map((b) => [`${b.dowBucket}:${b.hourBucket}`, b]),
    );
    expect(cells['0:10'].willBlend).toBe(true);
    expect(cells['0:10'].dowLabel).toBe('weekday');
    expect(cells['0:10'].ewmaValue).toBe(0.4568); // round to 4 decimals
    expect(cells['0:11'].isFresh).toBe(false);
    expect(cells['0:11'].willBlend).toBe(false);
    expect(cells['1:12'].isWellSampled).toBe(false);
    expect(cells['1:12'].willBlend).toBe(false);
    expect(cells['1:12'].dowLabel).toBe('saturday');
    expect(cells['1:14'].willBlend).toBe(true);
  });

  it('orders buckets by (dow_bucket, hour_bucket) via prisma orderBy', async () => {
    const prisma = makePrisma();
    prisma.lot.findUnique.mockResolvedValue({ id: 'l1', lot_id: 'G1' });
    prisma.penetrationRateEstimate.findMany.mockResolvedValue([]);
    const svc = new AdminPenetrationRateService(prisma as never);
    await svc.getForLot('l1');
    expect(prisma.penetrationRateEstimate.findMany).toHaveBeenCalledWith({
      where: { lot_id: 'l1' },
      orderBy: [{ dow_bucket: 'asc' }, { hour_bucket: 'asc' }],
    });
  });
});
