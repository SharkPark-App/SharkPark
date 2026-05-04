jest.mock('./_bootstrap', () => ({ runCronJob: jest.fn() }));
jest.mock('../lots/concept3d-client', () => ({
  fetchConcept3dLocations: jest.fn(),
}));

import { runCronJob } from './_bootstrap';
import { fetchConcept3dLocations } from '../lots/concept3d-client';
import './refresh-lot-metadata';

type WorkCtx = {
  prisma: {
    school: { findFirst: jest.Mock };
    lot: { findMany: jest.Mock };
  };
  logger: { log: jest.Mock; warn: jest.Mock; error: jest.Mock };
};
type WorkFn = (ctx: WorkCtx) => Promise<void>;

const call = (runCronJob as jest.Mock).mock.calls[0];
const work = call[2] as WorkFn;

function makeCtx(): WorkCtx {
  return {
    prisma: {
      school: { findFirst: jest.fn() },
      lot: { findMany: jest.fn() },
    },
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
  };
}

describe('refresh-lot-metadata cron', () => {
  beforeEach(() => {
    (fetchConcept3dLocations as jest.Mock).mockReset();
  });

  it('registers under refresh-lot-metadata with no feature modules', () => {
    expect(call[0]).toBe('refresh-lot-metadata');
    expect(call[1]).toEqual([]);
  });

  it('warns and exits when CSULB row is missing', async () => {
    const ctx = makeCtx();
    ctx.prisma.school.findFirst.mockResolvedValue(null);

    await work(ctx);

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining('no CSULB school row found'),
    );
    expect(fetchConcept3dLocations).not.toHaveBeenCalled();
  });

  it('logs an error when a lot has EV markers but ev_charging_stations=0', async () => {
    const ctx = makeCtx();
    ctx.prisma.school.findFirst.mockResolvedValue({ id: 'school-1' });
    ctx.prisma.lot.findMany.mockResolvedValue([
      { id: 'cuid-G14', lot_id: 'G14', ev_charging_stations: 0 },
    ]);
    (fetchConcept3dLocations as jest.Mock).mockResolvedValue([
      { id: 1, name: 'Lot G14 EV Station', catId: 41613 },
    ]);

    await work(ctx);

    expect(ctx.logger.error).toHaveBeenCalledWith(
      expect.stringMatching(/G14.*ev_charging_stations=0/),
    );
  });

  it('warns when curated stalls > 0 but concept3d has no marker', async () => {
    const ctx = makeCtx();
    ctx.prisma.school.findFirst.mockResolvedValue({ id: 'school-1' });
    ctx.prisma.lot.findMany.mockResolvedValue([
      { id: 'cuid-G14', lot_id: 'G14', ev_charging_stations: 4 },
    ]);
    (fetchConcept3dLocations as jest.Mock).mockResolvedValue([]);

    await work(ctx);

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/curated ev_charging_stations=4 for G14/),
    );
  });

  it('warns when concept3d references an unknown lot_id', async () => {
    const ctx = makeCtx();
    ctx.prisma.school.findFirst.mockResolvedValue({ id: 'school-1' });
    ctx.prisma.lot.findMany.mockResolvedValue([]);
    (fetchConcept3dLocations as jest.Mock).mockResolvedValue([
      { id: 1, name: 'Lot Z99 EV Station', catId: 41613 },
    ]);

    await work(ctx);

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringMatching(/unknown lot_id Z99/),
    );
  });

  it('maps Pyramid / Palo Verde North / Palo Verde South marker names to PYR/PVN/PVS', async () => {
    const ctx = makeCtx();
    ctx.prisma.school.findFirst.mockResolvedValue({ id: 'school-1' });
    ctx.prisma.lot.findMany.mockResolvedValue([
      { id: 'cuid-PYR', lot_id: 'PYR', ev_charging_stations: 2 },
      { id: 'cuid-PVN', lot_id: 'PVN', ev_charging_stations: 2 },
      { id: 'cuid-PVS', lot_id: 'PVS', ev_charging_stations: 2 },
    ]);
    (fetchConcept3dLocations as jest.Mock).mockResolvedValue([
      { id: 1, name: 'Pyramid Parking Structure EV', catId: 41613 },
      { id: 2, name: 'Palo Verde North EV Stalls', catId: 77326 },
      { id: 3, name: 'Palo Verde South EV Stalls', catId: 77326 },
    ]);

    await work(ctx);

    expect(ctx.logger.warn).not.toHaveBeenCalled();
    expect(ctx.logger.error).not.toHaveBeenCalled();
    for (const id of ['PYR', 'PVN', 'PVS']) {
      expect(ctx.logger.log).toHaveBeenCalledWith(
        expect.stringMatching(new RegExp(`${id}: curated stalls=2, concept3d markers=1`)),
      );
    }
  });

  it('warns when an EV marker name cannot be mapped to a lot', async () => {
    const ctx = makeCtx();
    ctx.prisma.school.findFirst.mockResolvedValue({ id: 'school-1' });
    ctx.prisma.lot.findMany.mockResolvedValue([]);
    (fetchConcept3dLocations as jest.Mock).mockResolvedValue([
      { id: 1, name: 'Random unmapped EV charger', catId: 41613 },
    ]);

    await work(ctx);

    expect(ctx.logger.warn).toHaveBeenCalledWith(
      expect.stringContaining("could not map EV marker 'Random unmapped EV charger'"),
    );
  });

  it('ignores non-EV concept3d markers', async () => {
    const ctx = makeCtx();
    ctx.prisma.school.findFirst.mockResolvedValue({ id: 'school-1' });
    ctx.prisma.lot.findMany.mockResolvedValue([
      { id: 'cuid-G14', lot_id: 'G14', ev_charging_stations: 0 },
    ]);
    (fetchConcept3dLocations as jest.Mock).mockResolvedValue([
      { id: 1, name: 'Lot G14 something', catId: 99999 },
    ]);

    await work(ctx);

    // No EV markers means no error/warn for G14.
    expect(ctx.logger.error).not.toHaveBeenCalled();
    expect(ctx.logger.warn).not.toHaveBeenCalled();
  });
});
