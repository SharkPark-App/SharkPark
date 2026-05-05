import { RefreshLotMetadataJob } from './refresh-lot-metadata.job';

jest.mock('../../lots/concept3d-client', () => ({
  __esModule: true,
  fetchConcept3dLocations: jest.fn(),
}));

import { fetchConcept3dLocations } from '../../lots/concept3d-client';
const mockedFetch = fetchConcept3dLocations as jest.Mock;

function makeRunner() {
  return {
    run: jest.fn(async (_name: string, work: () => Promise<void>) => {
      await work();
    }),
  };
}

function makeLogger() {
  return { log: jest.fn(), warn: jest.fn(), error: jest.fn() };
}

const EV_CAT_ID = 41613;

describe('RefreshLotMetadataJob', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('warns and returns when CSULB row is missing', async () => {
    const prisma = {
      school: { findFirst: jest.fn().mockResolvedValue(null) },
      lot: { findMany: jest.fn() },
    };
    const job = new RefreshLotMetadataJob(
      makeRunner() as never,
      prisma as never,
      makeLogger() as never,
    );

    await job.handle();
    expect(prisma.lot.findMany).not.toHaveBeenCalled();
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('flags discrepancies between concept3d markers and curated stalls', async () => {
    mockedFetch.mockResolvedValue([
      // Maps to lot G1 — known to seed with stalls > 0 (consistent)
      { id: 1, name: 'Lot G1 EV Charger', catId: EV_CAT_ID },
      // Maps to lot M5 — known but stalls == 0 (mismatch → error)
      { id: 2, name: 'Lot M5 Charger', catId: EV_CAT_ID },
      // Pyramid alias — unknown lot in DB (not in seed → warning)
      { id: 3, name: 'Pyramid EV', catId: EV_CAT_ID },
      // Name doesn't match any pattern → warning
      { id: 4, name: 'Mystery Garage Charger', catId: EV_CAT_ID },
      // Non-EV cat → filtered out before iteration
      { id: 5, name: 'Lot Z9 Restroom', catId: 1 },
    ]);
    const prisma = {
      school: { findFirst: jest.fn().mockResolvedValue({ id: 'school1' }) },
      lot: {
        findMany: jest.fn().mockResolvedValue([
          { id: 'cuid-g1', lot_id: 'G1', ev_charging_stations: 4 },
          { id: 'cuid-m5', lot_id: 'M5', ev_charging_stations: 0 },
          // Lot K7 has stalls in seed but no concept3d marker → warning
          { id: 'cuid-k7', lot_id: 'K7', ev_charging_stations: 2 },
        ]),
      },
    };
    const logger = makeLogger();
    const job = new RefreshLotMetadataJob(
      makeRunner() as never,
      prisma as never,
      logger as never,
    );

    await job.handle();

    // Mystery + Pyramid (unknown lot) trigger logger.warn paths;
    // M5 (markers but stalls=0) triggers logger.error;
    // K7 (stalls but no marker) triggers logger.warn.
    expect(logger.error).toHaveBeenCalledWith(
      expect.stringContaining('M5'),
    );
    expect(logger.warn).toHaveBeenCalled();
    // G1 is the consistent case → at least one .log call about G1
    const logCalls = (logger.log as jest.Mock).mock.calls
      .map((c) => c[0])
      .filter((m) => typeof m === 'string');
    expect(logCalls.some((m) => m.includes('G1'))).toBe(true);
  });
});
