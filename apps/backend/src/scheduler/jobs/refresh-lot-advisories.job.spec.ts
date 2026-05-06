import { RefreshLotAdvisoriesJob } from './refresh-lot-advisories.job';

jest.mock('../../lots/concept3d-client', () => ({
  __esModule: true,
  fetchConcept3dLocations: jest.fn(),
}));
jest.mock('../../lots/lot-advisory-extractor', () => ({
  __esModule: true,
  extractLotAdvisories: jest.fn(),
}));

import { fetchConcept3dLocations } from '../../lots/concept3d-client';
import { extractLotAdvisories } from '../../lots/lot-advisory-extractor';

const mockedFetch = fetchConcept3dLocations as jest.Mock;
const mockedExtract = extractLotAdvisories as jest.Mock;

function makeRunner() {
  return {
    run: jest.fn(async (_name: string, work: () => Promise<void>) => {
      await work();
    }),
  };
}

function makeLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() } as never;
}

describe('RefreshLotAdvisoriesJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('returns early and warns when no eligible schools exist', async () => {
    const prisma = {
      school: { findMany: jest.fn().mockResolvedValue([]) },
      lot: { findMany: jest.fn() },
      lotAdvisory: { updateMany: jest.fn(), upsert: jest.fn() },
    };
    const logger = makeLogger();
    const job = new RefreshLotAdvisoriesJob(
      makeRunner() as never,
      prisma as never,
      logger,
    );

    await job.handle();
    expect(prisma.lot.findMany).not.toHaveBeenCalled();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('upserts advisories for known lots and skips unknown lot_ids', async () => {
    mockedFetch.mockResolvedValue([{ id: 1, name: 'x', catId: 99 }]);
    mockedExtract.mockReturnValue({
      seeds: [
        {
          lot_id: 'KNOWN',
          source_marker_id: 100,
          source_cat_id: 99,
          title: 'Closed',
          description: 'Construction',
          severity: 'INFO',
          match_reason: 'overlap',
          polygon: [],
        },
        {
          lot_id: 'UNKNOWN',
          source_marker_id: 200,
          source_cat_id: 99,
          title: 'Closed',
          description: 'X',
          severity: 'INFO',
          match_reason: 'overlap',
          polygon: [],
        },
      ],
      stats: { candidateCount: 2, markerCount: 2 },
    });

    const prisma = {
      school: {
        findMany: jest
          .fn()
          .mockResolvedValue([{ id: 'school1', short_name: 'CSULB' }]),
      },
      lot: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'lot-cuid-1', lot_id: 'KNOWN', geofence_polygon: [] },
        ]),
      },
      lotAdvisory: {
        updateMany: jest.fn().mockResolvedValue({ count: 5 }),
        upsert: jest.fn().mockResolvedValue(undefined),
      },
    };
    const job = new RefreshLotAdvisoriesJob(
      makeRunner() as never,
      prisma as never,
      makeLogger(),
    );

    await job.handle();

    expect(prisma.lotAdvisory.updateMany).toHaveBeenCalledWith({
      where: {
        school_id: 'school1',
        source: 'CONCEPT3D',
        is_active: true,
      },
      data: { is_active: false },
    });
    // Only the KNOWN seed was upserted; UNKNOWN was skipped.
    expect(prisma.lotAdvisory.upsert).toHaveBeenCalledTimes(1);
    expect(prisma.lotAdvisory.upsert).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          uq_lot_advisory_source_lot: expect.objectContaining({
            lot_id: 'lot-cuid-1',
            source_marker_id: 100,
          }),
        }),
      }),
    );
  });
});
