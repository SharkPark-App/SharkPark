jest.mock('./_bootstrap', () => ({ runCronJob: jest.fn() }));
jest.mock('../lots/concept3d-client', () => ({
  fetchConcept3dLocations: jest.fn(),
}));
jest.mock('../lots/lot-advisory-extractor', () => ({
  extractLotAdvisories: jest.fn(),
}));

import { runCronJob } from './_bootstrap';
import { fetchConcept3dLocations } from '../lots/concept3d-client';
import { extractLotAdvisories } from '../lots/lot-advisory-extractor';
import './refresh-lot-advisories';

type WorkCtx = {
  prisma: {
    school: { findMany: jest.Mock };
    lot: { findMany: jest.Mock };
    lotAdvisory: { updateMany: jest.Mock; upsert: jest.Mock };
  };
  logger: { log: jest.Mock; warn: jest.Mock };
};
type WorkFn = (ctx: WorkCtx) => Promise<void>;

const call = (runCronJob as jest.Mock).mock.calls[0];
const work = call[2] as WorkFn;

function makeCtx(overrides: Partial<WorkCtx['prisma']> = {}): WorkCtx {
  return {
    prisma: {
      school: { findMany: jest.fn() },
      lot: { findMany: jest.fn() },
      lotAdvisory: { updateMany: jest.fn(), upsert: jest.fn() },
      ...overrides,
    } as WorkCtx['prisma'],
    logger: { log: jest.fn(), warn: jest.fn() },
  };
}

describe('refresh-lot-advisories cron', () => {
  beforeEach(() => {
    (fetchConcept3dLocations as jest.Mock).mockReset();
    (extractLotAdvisories as jest.Mock).mockReset();
  });

  it('registers under refresh-lot-advisories with no feature modules', () => {
    expect(call[0]).toBe('refresh-lot-advisories');
    expect(call[1]).toEqual([]);
  });

  it('warns and exits when no eligible school exists', async () => {
    const ctx = makeCtx();
    ctx.prisma.school.findMany.mockResolvedValue([]);

    await work(ctx);

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no eligible schools'),
    );
    expect(fetchConcept3dLocations).not.toHaveBeenCalled();
    expect(ctx.prisma.lotAdvisory.updateMany).not.toHaveBeenCalled();
  });

  it('deactivates prior advisories then upserts every seed mapped to a known lot', async () => {
    const ctx = makeCtx();
    ctx.prisma.school.findMany.mockResolvedValue([{ id: 'school-1', short_name: 'CSULB' }]);
    ctx.prisma.lot.findMany.mockResolvedValue([
      { id: 'cuid-A', lot_id: 'A', geofence_polygon: [{ lat: 0, lng: 0 }] },
      { id: 'cuid-B', lot_id: 'B', geofence_polygon: [{ lat: 1, lng: 1 }] },
    ]);
    ctx.prisma.lotAdvisory.updateMany.mockResolvedValue({ count: 3 });

    (fetchConcept3dLocations as jest.Mock).mockResolvedValue([{ id: 1, name: 'x', catId: 45989 }]);
    (extractLotAdvisories as jest.Mock).mockReturnValue({
      seeds: [
        {
          lot_id: 'A',
          title: 'Closed',
          description: null,
          severity: 'CLOSURE',
          source_cat_id: 45989,
          source_marker_id: 1,
          match_reason: 'polygon_overlap',
          polygon: [{ lat: 0, lng: 0 }],
        },
        {
          lot_id: 'GHOST', // not in DB → should be skipped
          title: 'Ghost',
          description: null,
          severity: 'INFO',
          source_cat_id: 91209,
          source_marker_id: 2,
          match_reason: 'name_mention',
          polygon: [],
        },
      ],
      stats: { candidateCount: 5, markerCount: 2 },
    });

    await work(ctx);

    expect(ctx.prisma.lotAdvisory.updateMany).toHaveBeenCalledWith({
      where: { school_id: 'school-1', source: 'CONCEPT3D', is_active: true },
      data: { is_active: false },
    });
    expect(ctx.prisma.lotAdvisory.upsert).toHaveBeenCalledTimes(1);
    const upsertArgs = ctx.prisma.lotAdvisory.upsert.mock.calls[0][0];
    expect(upsertArgs.where).toEqual({
      uq_lot_advisory_source_lot: {
        school_id: 'school-1',
        source: 'CONCEPT3D',
        source_marker_id: 1,
        lot_id: 'cuid-A',
      },
    });
    expect(upsertArgs.create).toMatchObject({
      school_id: 'school-1',
      lot_id: 'cuid-A',
      severity: 'CLOSURE',
      source: 'CONCEPT3D',
      is_active: true,
    });
    expect(upsertArgs.update).toMatchObject({
      severity: 'CLOSURE',
      is_active: true,
    });
    expect(ctx.logger.log).toHaveBeenCalledWith(
      expect.stringContaining('1 skipped — unknown lot_id'),
    );
  });
});
