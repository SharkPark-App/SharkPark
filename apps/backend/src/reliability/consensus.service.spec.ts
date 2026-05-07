import { EventType } from '@prisma/client';

import {
  ConsensusService,
  clip01,
  floorTo5Min,
  meanAbsoluteDeviation,
  median,
} from './consensus.service';

describe('consensus.service helpers', () => {
  describe('floorTo5Min', () => {
    it('floors to the nearest 5-minute UTC boundary', () => {
      expect(floorTo5Min(new Date('2026-05-07T12:34:56.789Z')).toISOString()).toBe(
        '2026-05-07T12:30:00.000Z',
      );
      expect(floorTo5Min(new Date('2026-05-07T12:35:00.000Z')).toISOString()).toBe(
        '2026-05-07T12:35:00.000Z',
      );
      expect(floorTo5Min(new Date('2026-05-07T12:39:59.999Z')).toISOString()).toBe(
        '2026-05-07T12:35:00.000Z',
      );
    });
  });

  describe('median', () => {
    it('returns 0 for empty input', () => {
      expect(median([])).toBe(0);
    });
    it('handles odd-length arrays', () => {
      expect(median([3, 1, 2])).toBe(2);
    });
    it('handles even-length arrays as the mean of the two middle values', () => {
      expect(median([1, 2, 3, 4])).toBe(2.5);
    });
  });

  describe('meanAbsoluteDeviation', () => {
    it('returns 0 for empty input', () => {
      expect(meanAbsoluteDeviation([], 0)).toBe(0);
    });
    it('computes mean absolute deviation around the given center', () => {
      expect(meanAbsoluteDeviation([1, 1, 1, 1], 1)).toBe(0);
      expect(meanAbsoluteDeviation([0, 2], 1)).toBe(1);
      expect(meanAbsoluteDeviation([1, 2, 3, 4], 2.5)).toBe(1);
    });
  });

  describe('clip01', () => {
    it('clamps to [0,1] and converts NaN to 0', () => {
      expect(clip01(-0.5)).toBe(0);
      expect(clip01(0)).toBe(0);
      expect(clip01(0.5)).toBe(0.5);
      expect(clip01(1)).toBe(1);
      expect(clip01(1.5)).toBe(1);
      expect(clip01(NaN)).toBe(0);
    });
  });
});

// ─── Service tests with mocked Prisma ────────────────────────────────────

interface MockPrisma {
  lot: { findMany: jest.Mock };
  occupancyEvent: { findMany: jest.Mock };
  occupancySnapshot: { findFirst: jest.Mock };
  deviceState: { count: jest.Mock };
  consensusObservation: { upsert: jest.Mock };
}

function makePrisma(): MockPrisma {
  return {
    lot: { findMany: jest.fn() },
    occupancyEvent: { findMany: jest.fn() },
    occupancySnapshot: { findFirst: jest.fn() },
    deviceState: { count: jest.fn() },
    consensusObservation: { upsert: jest.fn() },
  };
}

describe('ConsensusService', () => {
  const lotId = 'lot_1';
  const capacity = 100;
  const windowStart = new Date('2026-05-07T12:30:00.000Z');
  const windowEnd = new Date('2026-05-07T12:35:00.000Z');

  describe('processLiveTick', () => {
    it('writes a row per lot with events and skips lots with no events', async () => {
      const prisma = makePrisma();
      prisma.lot.findMany.mockResolvedValue([
        { id: 'lot_a', capacity: 100 },
        { id: 'lot_b', capacity: 50 },
      ]);
      // lot_a: claims = 1,2,3,2 → median=2, MAD=0.5, score=0.75 (>= 0.7).
      prisma.occupancyEvent.findMany.mockImplementation(({ where }) => {
        if (where.lot_id === 'lot_a') {
          return Promise.resolve([
            { event_type: EventType.ENTER, device_hash: 'd1', timestamp: windowStart },
            { event_type: EventType.ENTER, device_hash: 'd2', timestamp: windowStart },
            { event_type: EventType.ENTER, device_hash: 'd3', timestamp: windowStart },
            { event_type: EventType.EXIT, device_hash: 'd4', timestamp: windowStart },
          ]);
        }
        return Promise.resolve([]);
      });
      prisma.deviceState.count.mockResolvedValue(42);

      const svc = new ConsensusService(prisma as never);
      const now = new Date(windowEnd.getTime() + 1000); // 1s after window end
      const result = await svc.processLiveTick(now);

      expect(result).toEqual({ written: 1, skipped: 1 });
      expect(prisma.consensusObservation.upsert).toHaveBeenCalledTimes(1);
      const arg = prisma.consensusObservation.upsert.mock.calls[0][0];
      expect(arg.where).toEqual({
        lot_id_window_start: { lot_id: 'lot_a', window_start: windowStart },
      });
      expect(arg.create.contributor_count).toBe(4);
      expect(arg.create.observed_occupancy).toBe(42);
      expect(arg.create.observed_rate).toBe(0.42);
      expect(arg.create.is_ground_truth).toBe(true); // 4 contributors, score=0.75
    });

    it('does not throw when an individual lot fails', async () => {
      const prisma = makePrisma();
      prisma.lot.findMany.mockResolvedValue([{ id: 'lot_a', capacity: 100 }]);
      prisma.occupancyEvent.findMany.mockRejectedValue(new Error('db boom'));
      const svc = new ConsensusService(prisma as never);
      const result = await svc.processLiveTick(new Date(windowEnd.getTime() + 1000));
      expect(result).toEqual({ written: 0, skipped: 1 });
    });
  });

  describe('backfillWindow', () => {
    it('returns null and writes nothing when the window has zero events', async () => {
      const prisma = makePrisma();
      prisma.occupancyEvent.findMany.mockResolvedValue([]);
      const svc = new ConsensusService(prisma as never);
      const r = await svc.backfillWindow(lotId, windowStart, capacity);
      expect(r).toBeNull();
      expect(prisma.consensusObservation.upsert).not.toHaveBeenCalled();
    });

    it('marks is_ground_truth=false when contributor_count < 3 even with perfect agreement', async () => {
      const prisma = makePrisma();
      prisma.occupancyEvent.findMany.mockResolvedValue([
        { event_type: EventType.ENTER, device_hash: 'd1', timestamp: windowStart },
        { event_type: EventType.EXIT, device_hash: 'd2', timestamp: windowStart },
      ]);
      prisma.occupancySnapshot.findFirst.mockResolvedValue(null); // no snapshot nearby
      const svc = new ConsensusService(prisma as never);
      const r = await svc.backfillWindow(lotId, windowStart, capacity);
      expect(r).not.toBeNull();
      expect(r!.contributorCount).toBe(2);
      expect(r!.isGroundTruth).toBe(false);
      expect(r!.observedOccupancy).toBe(0); // no snapshot → 0
    });

    it('marks is_ground_truth=false when agreement is poor (high churn)', async () => {
      // 6 events from 4 distinct devices producing a wildly oscillating
      // running count: 1, 0, 1, 0, 1, 0 — median=0.5, MAD=0.5,
      // agreement = 1 - 0.5/max(0.5,1) = 0.5 (< 0.7).
      const prisma = makePrisma();
      prisma.occupancyEvent.findMany.mockResolvedValue([
        { event_type: EventType.ENTER, device_hash: 'd1', timestamp: windowStart },
        { event_type: EventType.EXIT, device_hash: 'd2', timestamp: windowStart },
        { event_type: EventType.ENTER, device_hash: 'd3', timestamp: windowStart },
        { event_type: EventType.EXIT, device_hash: 'd4', timestamp: windowStart },
        { event_type: EventType.ENTER, device_hash: 'd1', timestamp: windowStart },
        { event_type: EventType.EXIT, device_hash: 'd3', timestamp: windowStart },
      ]);
      prisma.occupancySnapshot.findFirst.mockResolvedValue({
        occupancy: 25,
        timestamp: windowEnd,
      });
      const svc = new ConsensusService(prisma as never);
      const r = await svc.backfillWindow(lotId, windowStart, capacity);
      expect(r).not.toBeNull();
      expect(r!.contributorCount).toBe(4);
      expect(r!.agreementScore).toBeCloseTo(0.5, 4);
      expect(r!.isGroundTruth).toBe(false); // score < 0.7
      expect(r!.observedOccupancy).toBe(25);
    });

    it('marks is_ground_truth=true when score >= 0.7 AND >= 3 contributors', async () => {
      // 5 ENTERs from 5 distinct devices, monotonically rising: 1,2,3,4,5.
      // median=3, MAD = mean(|1-3|+|2-3|+|3-3|+|4-3|+|5-3|)/5 = 6/5 = 1.2.
      // agreement = 1 - 1.2/3 = 0.6  → still below 0.7.
      // Use a more stable pattern: 4 enters then 4 exits = 1,2,3,4,3,2,1,0
      // median=2.5, MAD = 1, agreement = 1 - 1/2.5 = 0.6. Still < 0.7.
      // Use a stable claim: 3 events all ENTER from 3 devices → 1,2,3.
      // median=2, MAD=2/3, agreement=1-(2/3)/2 = 1-1/3 = 0.6667. Still < 0.7.
      // Use 4 ENTERs from 4 devices: 1,2,3,4. median=2.5, MAD=1, score=0.6.
      // For score>=0.7, MAD/max(median,1) <= 0.3. With 3 devices all ENTER:
      // claims=1,2,3, median=2, MAD=2/3≈0.667, score≈0.667.
      // The cleanest >=3-contributor, score>=0.7 case is 3 ENTERs followed
      // by a long stable tail — but 5-min windows are short. Use 5 events
      // from 3 devices that settle: ENTER,ENTER,ENTER,EXIT,EXIT
      // claims = 1,2,3,2,1 → median=2, MAD = (1+0+1+0+1)/5 = 0.6,
      // score = 1 - 0.6/2 = 0.7 exactly.
      const prisma = makePrisma();
      prisma.occupancyEvent.findMany.mockResolvedValue([
        { event_type: EventType.ENTER, device_hash: 'd1', timestamp: windowStart },
        { event_type: EventType.ENTER, device_hash: 'd2', timestamp: windowStart },
        { event_type: EventType.ENTER, device_hash: 'd3', timestamp: windowStart },
        { event_type: EventType.EXIT, device_hash: 'd1', timestamp: windowStart },
        { event_type: EventType.EXIT, device_hash: 'd2', timestamp: windowStart },
      ]);
      prisma.occupancySnapshot.findFirst.mockResolvedValue({
        occupancy: 17,
        timestamp: windowEnd,
      });
      const svc = new ConsensusService(prisma as never);
      const r = await svc.backfillWindow(lotId, windowStart, capacity);
      expect(r).not.toBeNull();
      expect(r!.contributorCount).toBe(3);
      expect(r!.agreementScore).toBeCloseTo(0.7, 4);
      expect(r!.isGroundTruth).toBe(true);
      expect(r!.observedOccupancy).toBe(17);
      expect(r!.observedRate).toBe(0.17);
    });

    it('uses the temporally-nearest snapshot when both before and after exist', async () => {
      const prisma = makePrisma();
      prisma.occupancyEvent.findMany.mockResolvedValue([
        { event_type: EventType.ENTER, device_hash: 'd1', timestamp: windowStart },
      ]);
      prisma.occupancySnapshot.findFirst
        // before (closer)
        .mockResolvedValueOnce({
          occupancy: 50,
          timestamp: new Date(windowEnd.getTime() - 60_000), // 1 min before
        })
        // after (farther)
        .mockResolvedValueOnce({
          occupancy: 99,
          timestamp: new Date(windowEnd.getTime() + 600_000), // 10 min after
        });
      const svc = new ConsensusService(prisma as never);
      const r = await svc.backfillWindow(lotId, windowStart, capacity);
      expect(r!.observedOccupancy).toBe(50);
    });
  });
});
