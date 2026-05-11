import carpoolDetectionService from '../src/services/carpoolDetectionService';
import type { GeofenceEvent } from '../src/types/location';

describe('carpoolDetectionService', () => {
  const g = globalThis as typeof globalThis & { crypto?: unknown };
  const originalCrypto = g.crypto;
  let nowSpy: jest.SpyInstance<number, []>;

  const makeEnterEvent = (regionId = 'G1'): GeofenceEvent => ({
    regionId,
    eventType: 'ENTER',
    timestamp: new Date().toISOString(),
  });

  beforeAll(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: {
        getRandomValues: (arr: Uint8Array) => {
          for (let i = 0; i < arr.length; i += 1) {
            arr[i] = (i + 1) & 0xff;
          }
          return arr;
        },
      },
    });
  });

  afterAll(() => {
    Object.defineProperty(globalThis, 'crypto', {
      configurable: true,
      value: originalCrypto,
    });
  });

  beforeEach(() => {
    jest.clearAllMocks();
    (carpoolDetectionService as unknown as { activeSessions: Map<string, unknown> }).activeSessions.clear();
    nowSpy = jest.spyOn(Date, 'now').mockReturnValue(1_000_000);
  });

  afterEach(() => {
    nowSpy.mockRestore();
  });

  it('ignores non-ENTER events when starting a session', async () => {
    const sessionId = await carpoolDetectionService.startDetectionSession(
      { regionId: 'G1', eventType: 'EXIT', timestamp: new Date().toISOString() },
      10,
      [],
    );

    expect(sessionId).toBe('');
  });

  it('returns null when analyzing an unknown session', async () => {
    const result = await carpoolDetectionService.analyzeCarpool('missing-session', 12);
    expect(result).toBeNull();
  });

  it('returns manual_only when occupancy did not increase', async () => {
    const sessionId = await carpoolDetectionService.startDetectionSession(makeEnterEvent(), 10, []);
    nowSpy.mockReturnValue(1_003_000);

    const result = await carpoolDetectionService.analyzeCarpool(sessionId, 10);

    expect(result).not.toBeNull();
    expect(result?.confidence).toBe(0);
    expect(result?.action).toBe('manual_only');
    expect(result?.estimatedPassengers).toBe(0);
  });

  it('returns prompt_user on moderate confidence signals', async () => {
    const sessionId = await carpoolDetectionService.startDetectionSession(makeEnterEvent(), 20, ['known']);
    carpoolDetectionService.recordBluetoothDevice(sessionId, 'new-device-1');
    nowSpy.mockReturnValue(1_004_000); // < 10s from ENTER

    const result = await carpoolDetectionService.analyzeCarpool(sessionId, 21);

    expect(result).not.toBeNull();
    expect(result?.confidence).toBeCloseTo(0.75, 5); // occupancy + fast BT
    expect(result?.action).toBe('prompt_user');
  });

  it('returns auto_toggle on high confidence with supporting signals', async () => {
    const sessionId = await carpoolDetectionService.startDetectionSession(makeEnterEvent(), 30, ['known']);
    carpoolDetectionService.recordBluetoothDevice(sessionId, 'new-device-1');
    carpoolDetectionService.recordMotionBurst(sessionId);
    nowSpy.mockReturnValue(1_003_000); // < 5s from ENTER

    const result = await carpoolDetectionService.analyzeCarpool(sessionId, 32);

    expect(result).not.toBeNull();
    expect(result?.confidence).toBeCloseTo(0.9, 5); // occupancy + fast BT + motion
    expect(result?.action).toBe('auto_toggle');
    expect(result?.estimatedPassengers).toBe(2);
  });

  it('does not count already-known Bluetooth devices as new', async () => {
    const sessionId = await carpoolDetectionService.startDetectionSession(makeEnterEvent(), 40, ['known-device']);
    carpoolDetectionService.recordBluetoothDevice(sessionId, 'known-device');
    nowSpy.mockReturnValue(1_004_000);

    const result = await carpoolDetectionService.analyzeCarpool(sessionId, 41);

    expect(result).not.toBeNull();
    expect(result?.signals.newBluetoothDevices).toEqual([]);
    expect(result?.confidence).toBeCloseTo(0.35, 5);
    expect(result?.action).toBe('manual_only');
  });

  it('includes WiFi contribution only when two or more joins occur in window', async () => {
    const sessionId = await carpoolDetectionService.startDetectionSession(makeEnterEvent(), 50, []);
    carpoolDetectionService.recordWifiClientJoin(sessionId);
    carpoolDetectionService.recordWifiClientJoin(sessionId);
    nowSpy.mockReturnValue(1_008_000); // < 20s from ENTER

    const result = await carpoolDetectionService.analyzeCarpool(sessionId, 51);

    expect(result).not.toBeNull();
    expect(result?.signals.wifiClientsJoined).toBe(2);
    expect(result?.confidence).toBeCloseTo(0.45, 5); // occupancy + wifi only
    expect(result?.action).toBe('manual_only');
  });

  it('ends session and clears stored analysis result', async () => {
    const sessionId = await carpoolDetectionService.startDetectionSession(makeEnterEvent(), 15, []);
    nowSpy.mockReturnValue(1_004_000);
    await carpoolDetectionService.analyzeCarpool(sessionId, 16);

    expect(carpoolDetectionService.getSessionResult(sessionId)).toBeDefined();

    carpoolDetectionService.endDetectionSession(sessionId);

    expect(carpoolDetectionService.getSessionResult(sessionId)).toBeUndefined();
  });
});
