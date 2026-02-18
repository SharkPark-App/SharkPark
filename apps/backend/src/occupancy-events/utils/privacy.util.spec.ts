import { hashDeviceId, generateEventId } from './privacy.util';

describe('Privacy Utilities', () => {
  describe('hashDeviceId', () => {
    it('should return a 64-character hex string', () => {
      const result = hashDeviceId('test-device-id');
      expect(result).toHaveLength(64);
      expect(result).toMatch(/^[a-f0-9]+$/);
    });

    it('should produce consistent hashes for the same input', () => {
      const hash1 = hashDeviceId('same-device');
      const hash2 = hashDeviceId('same-device');
      expect(hash1).toBe(hash2);
    });

    it('should produce different hashes for different inputs', () => {
      const hash1 = hashDeviceId('device-1');
      const hash2 = hashDeviceId('device-2');
      expect(hash1).not.toBe(hash2);
    });

    it('should throw error for empty string', () => {
      expect(() => hashDeviceId('')).toThrow('Device ID must be a non-empty string');
    });

    it('should throw error for null/undefined', () => {
      expect(() => hashDeviceId(null as unknown as string)).toThrow();
      expect(() => hashDeviceId(undefined as unknown as string)).toThrow();
    });
  });

  describe('generateEventId', () => {
    it('should return a string with timestamp and random suffix', () => {
      const eventId = generateEventId();
      expect(eventId).toMatch(/^\d+-[a-z0-9]+$/);
    });

    it('should generate unique IDs', () => {
      const ids = new Set<string>();
      for (let i = 0; i < 100; i++) {
        ids.add(generateEventId());
      }
      expect(ids.size).toBe(100);
    });
  });
});
