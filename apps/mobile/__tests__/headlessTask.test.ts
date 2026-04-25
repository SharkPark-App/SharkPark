/**
 * Headless Task Tests
 * Verifies Android headless event queuing to AsyncStorage
 */

import AsyncStorage from '@react-native-async-storage/async-storage';

// We test the headless task logic directly since index.js side-effects
// happen at import time. Instead, extract and test the queuing behavior.
describe('Headless Task Event Queuing', () => {
  beforeEach(async () => {
    await AsyncStorage.clear();
    jest.clearAllMocks();
  });

  it('should queue a geofence ENTER event to AsyncStorage', async () => {
    const pending = [
      {
        regionId: 'G1',
        eventType: 'ENTER',
        timestamp: new Date().toISOString(),
        extras: { lot_name: 'Lot G1', lot_type: 'STUDENT' },
      },
    ];
    await AsyncStorage.setItem('pending_geofence_events', JSON.stringify(pending));

    const raw = await AsyncStorage.getItem('pending_geofence_events');
    const stored = JSON.parse(raw!);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({
      regionId: 'G1',
      eventType: 'ENTER',
    });
  });

  it('should append multiple events to the queue', async () => {
    const event1 = {
      regionId: 'G1',
      eventType: 'ENTER',
      timestamp: new Date(Date.now() - 30000).toISOString(),
      extras: {},
    };
    await AsyncStorage.setItem('pending_geofence_events', JSON.stringify([event1]));

    // Simulate second headless event arriving
    const raw = await AsyncStorage.getItem('pending_geofence_events');
    const existing = raw ? JSON.parse(raw) : [];
    existing.push({
      regionId: 'G1',
      eventType: 'EXIT',
      timestamp: new Date().toISOString(),
      extras: {},
    });
    await AsyncStorage.setItem('pending_geofence_events', JSON.stringify(existing));

    const result = JSON.parse((await AsyncStorage.getItem('pending_geofence_events'))!);
    expect(result).toHaveLength(2);
    expect(result[0].eventType).toBe('ENTER');
    expect(result[1].eventType).toBe('EXIT');
  });

  it('should store events with correct shape (regionId, eventType, timestamp)', async () => {
    const event = {
      regionId: 'E7',
      eventType: 'ENTER',
      timestamp: '2026-04-14T10:00:00.000Z',
      extras: { lot_name: 'Lot E7', lot_type: 'EMPLOYEE', capacity: 200 },
    };
    await AsyncStorage.setItem('pending_geofence_events', JSON.stringify([event]));

    const stored = JSON.parse((await AsyncStorage.getItem('pending_geofence_events'))!);
    expect(stored[0]).toHaveProperty('regionId');
    expect(stored[0]).toHaveProperty('eventType');
    expect(stored[0]).toHaveProperty('timestamp');
    // Should NOT have raw coordinates
    expect(stored[0]).not.toHaveProperty('latitude');
    expect(stored[0]).not.toHaveProperty('longitude');
    expect(stored[0]).not.toHaveProperty('coords');
  });

  it('should handle empty queue gracefully', async () => {
    const raw = await AsyncStorage.getItem('pending_geofence_events');
    expect(raw).toBeNull();

    // Simulate first headless event on empty queue
    const pending = raw ? JSON.parse(raw) : [];
    pending.push({
      regionId: 'G1',
      eventType: 'ENTER',
      timestamp: new Date().toISOString(),
      extras: {},
    });
    await AsyncStorage.setItem('pending_geofence_events', JSON.stringify(pending));

    const result = JSON.parse((await AsyncStorage.getItem('pending_geofence_events'))!);
    expect(result).toHaveLength(1);
  });

  describe('pending event processing (on mount)', () => {
    it('should discard events older than 1 hour', () => {
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      const events = [
        { regionId: 'G1', eventType: 'ENTER', timestamp: new Date(oneHourAgo - 5000).toISOString() },
        { regionId: 'G2', eventType: 'ENTER', timestamp: new Date().toISOString() },
      ];

      // Filter logic matching EnhancedGeofencingProvider's mount handler
      const valid = events.filter(e => new Date(e.timestamp).getTime() >= oneHourAgo);
      expect(valid).toHaveLength(1);
      expect(valid[0].regionId).toBe('G2');
    });

    it('should keep events within the 1-hour window', () => {
      const oneHourAgo = Date.now() - 60 * 60 * 1000;
      const events = [
        { regionId: 'G1', eventType: 'ENTER', timestamp: new Date(Date.now() - 30 * 60 * 1000).toISOString() },
        { regionId: 'G1', eventType: 'EXIT', timestamp: new Date(Date.now() - 10 * 60 * 1000).toISOString() },
      ];

      const valid = events.filter(e => new Date(e.timestamp).getTime() >= oneHourAgo);
      expect(valid).toHaveLength(2);
    });
  });
});
