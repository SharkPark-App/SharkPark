import { Test } from '@nestjs/testing';
import { PermitFeesController } from './permit-fees.controller';
import {
  CSULB_PERMIT_FEES,
  buildAppliedFees,
  pickPreferredParkMobileZone,
} from './permit-fees';

describe('permit-fees', () => {
  describe('PermitFeesController', () => {
    let controller: PermitFeesController;

    beforeEach(async () => {
      const moduleRef = await Test.createTestingModule({
        controllers: [PermitFeesController],
      }).compile();
      controller = moduleRef.get(PermitFeesController);
    });

    it('returns the static CSULB fee schedule', () => {
      const result = controller.getPermitFees();
      expect(result.success).toBe(true);
      expect(result.data).toBe(CSULB_PERMIT_FEES);
      expect(result.data.visitor.daily).toBe(15);
      expect(result.data.visitor.evening_weekend.price).toBe(10);
      expect(result.data.visitor.overnight.available_at_lots).toContain('G2');
    });

    it('lists three short-term tiers (30/60/90 min)', () => {
      const tiers = controller.getPermitFees().data.visitor.short_term;
      expect(tiers).toHaveLength(3);
      expect(tiers.map((t) => t.max_minutes)).toEqual([30, 60, 90]);
      expect(tiers.map((t) => t.price)).toEqual([4, 6, 10]);
    });

    it('exposes umbrella ParkMobile zones', () => {
      const { umbrella_zones } = controller.getPermitFees().data.parkmobile;
      expect(umbrella_zones.general).toBe('3993');
      expect(umbrella_zones.employee).toBe('3975');
    });
  });

  describe('buildAppliedFees', () => {
    it('includes short-term when the lot has signed short-term spaces', () => {
      const fees = buildAppliedFees({
        lot_id: 'G4',
        daily_permit_allowed: true,
        short_term_parking_spaces: 12,
      });
      expect(fees.short_term).toEqual(CSULB_PERMIT_FEES.visitor.short_term);
      expect(fees.daily).toBe(15);
      expect(fees.evening_weekend.price).toBe(10);
      expect(fees.overnight).toBeNull();
    });

    it('omits short-term and daily when the lot supports neither', () => {
      const fees = buildAppliedFees({
        lot_id: 'E5',
        daily_permit_allowed: false,
        short_term_parking_spaces: 0,
      });
      expect(fees.short_term).toBeNull();
      expect(fees.daily).toBeNull();
      // Evening/weekend rate applies to every lot
      expect(fees.evening_weekend.price).toBe(10);
      expect(fees.overnight).toBeNull();
    });

    it('attaches the overnight block only for G2 (Walter Pyramid)', () => {
      const g2 = buildAppliedFees({
        lot_id: 'G2',
        daily_permit_allowed: true,
        short_term_parking_spaces: 0,
      });
      expect(g2.overnight).toEqual(CSULB_PERMIT_FEES.visitor.overnight);

      const g1 = buildAppliedFees({
        lot_id: 'G1',
        daily_permit_allowed: true,
        short_term_parking_spaces: 0,
      });
      expect(g1.overnight).toBeNull();
    });
  });

  describe('pickPreferredParkMobileZone', () => {
    it('returns null when the lot has no zones', () => {
      expect(pickPreferredParkMobileZone([])).toBeNull();
    });

    it('prefers a lot-specific zone over an umbrella zone', () => {
      expect(pickPreferredParkMobileZone(['3993', '3921'])).toBe('3921');
      expect(pickPreferredParkMobileZone(['3949', '3975'])).toBe('3949');
    });

    it('falls back to an umbrella zone when no specific zone is present', () => {
      expect(pickPreferredParkMobileZone(['3993'])).toBe('3993');
      expect(pickPreferredParkMobileZone(['3975'])).toBe('3975');
    });
  });
});
