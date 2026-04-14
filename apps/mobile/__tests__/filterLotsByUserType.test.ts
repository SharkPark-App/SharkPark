/**
 * Unit tests for filterLotsByUserType() (deprecated wrapper)
 *
 * filterLotsByUserType is kept for backward compatibility.
 * The real allocation logic lives in DynamicGeofenceManager.
 * These tests verify the wrapper still returns the expected guaranteed set.
 */

// Mock all native modules that EnhancedGeofencingProvider imports so Jest
// doesn't try to load them in a Node environment.
jest.mock('../src/services/locationService', () => ({ default: {} }));
jest.mock('../src/services/parkingValidationService', () => ({ default: {} }));
jest.mock('../src/services/leaveDetectionService', () => ({ default: {} }));
jest.mock('../src/services/dynamicGeofenceManager', () => ({
  __esModule: true,
  default: { computeGeofenceSet: jest.fn(), shouldRecalculate: jest.fn(), reset: jest.fn() },
}));
jest.mock('../src/services/api', () => ({ lotsApi: {} }));
jest.mock('../src/context/AuthContext', () => ({
  useAuth: jest.fn(),
}));
jest.mock('../src/utils/geofenceUtils', () => ({ createGeofenceRegionsFromLots: jest.fn() }));

import { filterLotsByUserType } from '../src/context/EnhancedGeofencingProvider';

// Minimal lot shape — only lot_type matters for this function
const makeLot = (lot_type: string, lot_id: string) => ({ lot_id, lot_type });

const studentLots = [
  makeLot('STUDENT', 'G1'),
  makeLot('STUDENT', 'G2'),
  makeLot('STUDENT', 'G3'),
];

const employeeLots = [
  makeLot('EMPLOYEE', 'E1'),
  makeLot('EMPLOYEE', 'E2'),
];

const mixedLots = [...studentLots, ...employeeLots];

describe('filterLotsByUserType', () => {
  describe('student email (@student.csulb.edu)', () => {
    it('returns only STUDENT lots', () => {
      const result = filterLotsByUserType(mixedLots, 'john.doe@student.csulb.edu');
      expect(result.every(l => l.lot_type === 'STUDENT')).toBe(true);
      expect(result).toHaveLength(3);
    });

    it('excludes EMPLOYEE lots', () => {
      const result = filterLotsByUserType(mixedLots, 'john.doe@student.csulb.edu');
      expect(result.some(l => l.lot_type === 'EMPLOYEE')).toBe(false);
    });
  });

  describe('employee email (@csulb.edu)', () => {
    it('returns both EMPLOYEE and STUDENT lots', () => {
      const result = filterLotsByUserType(mixedLots, 'prof.smith@csulb.edu');
      expect(result.some(l => l.lot_type === 'EMPLOYEE')).toBe(true);
      expect(result.some(l => l.lot_type === 'STUDENT')).toBe(true);
      expect(result).toHaveLength(mixedLots.length);
    });

    it('returns E-lots before G-lots', () => {
      const result = filterLotsByUserType(mixedLots, 'prof.smith@csulb.edu');
      const firstStudentIndex = result.findIndex(l => l.lot_type === 'STUDENT');
      const lastEmployeeIndex = result.map(l => l.lot_type).lastIndexOf('EMPLOYEE');
      expect(lastEmployeeIndex).toBeLessThan(firstStudentIndex);
    });

    it('does not match a student email as employee (isStudent guard)', () => {
      // @student.csulb.edu also ends with @csulb.edu — the guard must catch this
      const result = filterLotsByUserType(mixedLots, 'jane@student.csulb.edu');
      expect(result.every(l => l.lot_type === 'STUDENT')).toBe(true);
    });
  });

  describe('unknown / empty email', () => {
    it('returns empty array for an unrecognised email domain', () => {
      const result = filterLotsByUserType(mixedLots, 'someone@gmail.com');
      expect(result).toEqual([]);
    });

    it('returns empty array for an empty string', () => {
      const result = filterLotsByUserType(mixedLots, '');
      expect(result).toEqual([]);
    });
  });

  describe('OS 20-geofence safety cap', () => {
    it('never returns more than 20 lots regardless of input size', () => {
      const manyStudentLots = Array.from({ length: 25 }, (_, i) =>
        makeLot('STUDENT', `G${i + 1}`),
      );
      const result = filterLotsByUserType(manyStudentLots, 'big@student.csulb.edu');
      expect(result.length).toBeLessThanOrEqual(20);
    });

    it('returns all lots when count is under the cap', () => {
      const result = filterLotsByUserType(studentLots, 'a@student.csulb.edu');
      expect(result).toHaveLength(studentLots.length);
    });
  });

  describe('empty lot list', () => {
    it('returns empty array when no lots are provided', () => {
      expect(filterLotsByUserType([], 'a@student.csulb.edu')).toEqual([]);
      expect(filterLotsByUserType([], 'b@csulb.edu')).toEqual([]);
    });
  });
});
