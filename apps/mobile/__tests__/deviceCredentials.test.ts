/**
 * Tests for deviceCredentials.ts
 *
 * Covers the access-tier header injection contract:
 *   - x-device-id is stable across calls (persisted in AsyncStorage)
 *   - HMAC headers are added only when DEVICE_EVENT_SECRET is bundled AND
 *     the request has a body
 *   - signPayload matches a known HMAC-SHA256 test vector (RFC 4231 case 2)
 */

import AsyncStorage from '@react-native-async-storage/async-storage';
import {
  __resetForTests,
  __setEventSecretForTests,
  buildAuthHeaders,
  getDeviceId,
  signPayload,
} from '../src/services/api/deviceCredentials';

describe('deviceCredentials', () => {
  beforeEach(async () => {
    __resetForTests();
    await AsyncStorage.clear();
    __setEventSecretForTests(undefined);
  });

  describe('getDeviceId', () => {
    it('generates a UUID v4 on first call and persists it', async () => {
      const id = await getDeviceId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
      const stored = await AsyncStorage.getItem('@sharkpark_anonymous_device_id');
      expect(stored).toBe(id);
    });

    it('returns the same id across calls', async () => {
      const a = await getDeviceId();
      const b = await getDeviceId();
      expect(a).toBe(b);
    });

    it('reuses a previously persisted id', async () => {
      await AsyncStorage.setItem('@sharkpark_anonymous_device_id', 'preexisting-id');
      const id = await getDeviceId();
      expect(id).toBe('preexisting-id');
    });
  });

  describe('buildAuthHeaders', () => {
    it('always includes x-device-id', async () => {
      const headers = await buildAuthHeaders();
      expect(headers['x-device-id']).toBeDefined();
      expect(headers['X-SharkPark-Signature']).toBeUndefined();
      expect(headers['X-SharkPark-Timestamp']).toBeUndefined();
    });

    it('omits HMAC headers when no secret is bundled, even with a body', async () => {
      __setEventSecretForTests(undefined);
      const headers = await buildAuthHeaders({ body: '{"hello":"world"}' });
      expect(headers['X-SharkPark-Signature']).toBeUndefined();
      expect(headers['X-SharkPark-Timestamp']).toBeUndefined();
    });

    it('omits HMAC headers when a secret is bundled but no body is sent', async () => {
      __setEventSecretForTests('shared-secret');
      const headers = await buildAuthHeaders();
      expect(headers['X-SharkPark-Signature']).toBeUndefined();
      expect(headers['X-SharkPark-Timestamp']).toBeUndefined();
    });

    it('includes HMAC headers when both secret and body are present', async () => {
      __setEventSecretForTests('shared-secret');
      const body = '{"lot_id":"G1"}';
      const headers = await buildAuthHeaders({ body });

      expect(headers['X-SharkPark-Timestamp']).toMatch(/^\d+$/);
      expect(headers['X-SharkPark-Signature']).toMatch(/^[0-9a-f]{64}$/);

      // Re-derive and verify the signature is over `${timestamp}.${body}`
      const expected = signPayload(`${headers['X-SharkPark-Timestamp']}.${body}`, 'shared-secret');
      expect(headers['X-SharkPark-Signature']).toBe(expected);
    });
  });

  describe('signPayload', () => {
    // RFC 4231 Test Case 2: key="Jefe", data="what do ya want for nothing?"
    // Expected HMAC-SHA256 = 5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843
    it('matches the RFC 4231 test vector for HMAC-SHA256', () => {
      const sig = signPayload('what do ya want for nothing?', 'Jefe');
      expect(sig).toBe('5bdcc146bf60754e6a042426089575c75a003f089d2739839dec58b964ec3843');
    });

    it('is deterministic for the same input', () => {
      const a = signPayload('payload', 'secret');
      const b = signPayload('payload', 'secret');
      expect(a).toBe(b);
    });

    it('changes when the payload changes', () => {
      const a = signPayload('a', 'secret');
      const b = signPayload('b', 'secret');
      expect(a).not.toBe(b);
    });
  });
});
