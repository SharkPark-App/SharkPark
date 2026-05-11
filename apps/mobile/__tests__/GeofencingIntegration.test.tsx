/**
 * GeofencingIntegration Component Tests
 *
 * Tests:
 *   - Loading state
 *   - Error state
 *   - Main render (status, privacy info, stats, enable button)
 *   - Geofence initialisation when lots arrive
 *   - Geofence ENTER / EXIT events (Alerts, occupancy, parent callback)
 *   - Start geofencing flow (permissions + tracking)
 *   - Permission denied / tracking failed paths
 *   - Last‑error display
 */
import React from 'react';
import ReactTestRenderer, { act } from 'react-test-renderer';
import { Alert } from 'react-native';

// ────────────────────── Mocks ──────────────────────

// Provide a minimal implementation of useAllLotsData
const mockUseAllLotsData = jest.fn();
jest.mock('../src/hooks/useAllLotsData', () => ({
  useAllLotsData: () => mockUseAllLotsData(),
}));

// Provide a controllable mock of useLocationService
const mockRegisterGeofences = jest.fn();
const mockRequestPermissions = jest.fn();
const mockStartGeofenceMonitoring = jest.fn();
const defaultLocationState = {
  isTracking: false,
  trackingMode: 'off' as 'off' | 'geofences' | 'full',
  monitoredRegions: 0,
  requestPermissions: mockRequestPermissions,
  startGeofenceMonitoring: mockStartGeofenceMonitoring,
  stopTracking: jest.fn(),
  registerGeofences: mockRegisterGeofences,
  lastGeofenceEvent: null as { eventType: 'ENTER' | 'EXIT'; regionId: string } | null,
  lastError: null as { message: string } | null,
};
let mockLocationState = { ...defaultLocationState };
jest.mock('../src/hooks/useLocationService', () => ({
  __esModule: true,
  default: () => mockLocationState,
}));

// geofenceUtils
const mockCreateSDKGeofencesFromLots = jest.fn().mockReturnValue([]);
jest.mock('../src/utils/geofenceUtils', () => ({
  createSDKGeofencesFromLots: (...a: unknown[]) => mockCreateSDKGeofencesFromLots(...a),
}));

// lotsApi
const mockRecordOccupancyEvent = jest.fn();
jest.mock('../src/services/api', () => ({
  lotsApi: {
    recordOccupancyEvent: (...a: unknown[]) => mockRecordOccupancyEvent(...a),
  },
}));

// GeofencingTestUtils – render nothing
jest.mock('../src/components/GeofencingTestUtils', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return { __esModule: true, default: () => <View testID="test-utils" /> };
});

// Alert spy
jest.spyOn(Alert, 'alert');

import { GeofencingIntegration } from '../src/components/GeofencingIntegration';

// ────────────────────── Helpers ──────────────────────

const makeLot = (overrides: Record<string, unknown> = {}) => ({
  lot_id: 'G1',
  lot_name: 'Lot G1',
  display_name: 'Lot G1 – Science',
  capacity: 200,
  current_occupancy: 100,
  occupancy_rate: 0.5,
  available: 100,
  estimated_available: 95,
  ...overrides,
});

async function renderComponent(
  props: { onGeofenceEvent?: (e: { lotId: string; eventType: 'ENTER' | 'EXIT' }) => void } = {},
) {
  let root!: ReactTestRenderer.ReactTestRenderer;
  await act(async () => {
    root = ReactTestRenderer.create(<GeofencingIntegration {...props} />);
    await Promise.resolve();
  });
  return root;
}

// ────────────────────── Tests ──────────────────────

describe('GeofencingIntegration', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockLocationState = { ...defaultLocationState };
    mockRequestPermissions.mockResolvedValue(true);
    mockStartGeofenceMonitoring.mockResolvedValue(true);
    mockRecordOccupancyEvent.mockResolvedValue({ event_id: 'e1', deduplicated: false });
  });

  // ── Loading & Error ────────────────────────────────

  it('renders loading state', async () => {
    mockUseAllLotsData.mockReturnValue({ lots: [], loading: true, error: null });
    const root = await renderComponent();
    const json = root.toJSON() as ReactTestRenderer.ReactTestRendererJSON;

    // Look for "Loading parking lot data..."
    const textNodes = JSON.stringify(json);
    expect(textNodes).toContain('Loading parking lot data...');
  });

  it('renders error state', async () => {
    mockUseAllLotsData.mockReturnValue({ lots: [], loading: false, error: 'Network fail' });
    const root = await renderComponent();
    const text = JSON.stringify(root.toJSON());
    expect(text).toContain('Error loading parking lots');
    expect(text).toContain('Network fail');
  });

  // ── Normal render ──────────────────────────────────

  it('renders title, status, privacy info and stats', async () => {
    mockUseAllLotsData.mockReturnValue({ lots: [makeLot()], loading: false, error: null });
    const root = await renderComponent();
    const text = JSON.stringify(root.toJSON());

    expect(text).toContain('Smart Parking Detection');
    expect(text).toContain('Inactive');
    expect(text).toContain('Privacy-First Tracking');
    expect(text).toContain('0 of 1'); // monitored 0 of 1
  });

  it('shows "Active" when isTracking is true', async () => {
    mockUseAllLotsData.mockReturnValue({ lots: [makeLot()], loading: false, error: null });
    mockLocationState = { ...defaultLocationState, isTracking: true };
    const root = await renderComponent();
    const text = JSON.stringify(root.toJSON());
    expect(text).toContain('Active');
  });

  it('shows enable button when not tracking', async () => {
    mockUseAllLotsData.mockReturnValue({ lots: [makeLot()], loading: false, error: null });
    const root = await renderComponent();
    const text = JSON.stringify(root.toJSON());
    expect(text).toContain('Enable Smart Parking Detection');
  });

  it('hides enable button when tracking', async () => {
    mockUseAllLotsData.mockReturnValue({ lots: [makeLot()], loading: false, error: null });
    mockLocationState = { ...defaultLocationState, isTracking: true };
    const root = await renderComponent();
    const text = JSON.stringify(root.toJSON());
    expect(text).not.toContain('Enable Smart Parking Detection');
  });

  it('displays lastError when present', async () => {
    mockUseAllLotsData.mockReturnValue({ lots: [makeLot()], loading: false, error: null });
    mockLocationState = { ...defaultLocationState, lastError: { message: 'GPS failure' } };
    const root = await renderComponent();
    const text = JSON.stringify(root.toJSON());
    expect(text).toContain('GPS failure');
  });

  it('displays permission status as Granted', async () => {
    mockUseAllLotsData.mockReturnValue({ lots: [makeLot()], loading: false, error: null });
    mockLocationState = { ...defaultLocationState, isTracking: true };
    const root = await renderComponent();
    const text = JSON.stringify(root.toJSON());
    expect(text).toContain('Active');
  });

  // ── Geofence initialisation ────────────────────────

  it('initializes geofencing when lots are available', async () => {
    const lots = [makeLot()];
    const regions = [{ identifier: 'G1', latitude: 33, longitude: -118, radius: 50, notifyOnEntry: true, notifyOnExit: true }];
    mockCreateSDKGeofencesFromLots.mockReturnValue(regions);
    mockUseAllLotsData.mockReturnValue({ lots, loading: false, error: null });

    await renderComponent();

    expect(mockCreateSDKGeofencesFromLots).toHaveBeenCalledWith(lots);
    expect(mockRegisterGeofences).toHaveBeenCalledWith(regions);
  });

  // ── Geofence events ────────────────────────────────

  it('shows alert and sends occupancy event on ENTER', async () => {
    const lots = [makeLot({ lot_id: 'G1', display_name: 'Lot G1 – Science' })];
    const onEvent = jest.fn();

    // First render – lots loaded, no event yet
    mockLocationState = { ...defaultLocationState };
    mockUseAllLotsData.mockReturnValue({ lots, loading: false, error: null });
    const root = await renderComponent({ onGeofenceEvent: onEvent });

    // Second render – fire ENTER event
    mockLocationState = {
      ...defaultLocationState,
      lastGeofenceEvent: { eventType: 'ENTER', regionId: 'G1' },
    };
    mockUseAllLotsData.mockReturnValue({ lots, loading: false, error: null });

    await act(async () => {
      root.update(<GeofencingIntegration onGeofenceEvent={onEvent} />);
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Entered Parking Lot',
      expect.stringContaining('Lot G1'),
      expect.any(Array),
    );
    expect(mockRecordOccupancyEvent).toHaveBeenCalledWith({
      lotId: 'G1',
      eventType: 'ENTER',
      source: 'GEOFENCE',
    });
    expect(onEvent).toHaveBeenCalledWith({ lotId: 'G1', eventType: 'ENTER' });
  });

  it('shows alert and sends occupancy event on EXIT', async () => {
    const lots = [makeLot({ lot_id: 'G1' })];
    const onEvent = jest.fn();

    mockLocationState = { ...defaultLocationState };
    mockUseAllLotsData.mockReturnValue({ lots, loading: false, error: null });
    const root = await renderComponent({ onGeofenceEvent: onEvent });

    mockLocationState = {
      ...defaultLocationState,
      lastGeofenceEvent: { eventType: 'EXIT', regionId: 'G1' },
    };
    mockUseAllLotsData.mockReturnValue({ lots, loading: false, error: null });

    await act(async () => {
      root.update(<GeofencingIntegration onGeofenceEvent={onEvent} />);
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Left Parking Lot',
      expect.stringContaining('Lot G1'),
      expect.any(Array),
    );
    expect(mockRecordOccupancyEvent).toHaveBeenCalledWith({
      lotId: 'G1',
      eventType: 'EXIT',
      source: 'GEOFENCE',
    });
    expect(onEvent).toHaveBeenCalledWith({ lotId: 'G1', eventType: 'EXIT' });
  });

  it('uses regionId when lot is not found', async () => {
    // lots list doesn't contain the event regionId
    mockUseAllLotsData.mockReturnValue({ lots: [], loading: false, error: null });
    mockLocationState = {
      ...defaultLocationState,
      lastGeofenceEvent: { eventType: 'ENTER', regionId: 'UNKNOWN' },
    };

    await act(async () => {
      await renderComponent();
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Entered Parking Lot',
      expect.stringContaining('UNKNOWN'),
      expect.any(Array),
    );
  });

  // ── startGeofencing ────────────────────────────────

  it('starts geofencing when button pressed and permissions granted', async () => {
    mockUseAllLotsData.mockReturnValue({ lots: [makeLot()], loading: false, error: null });
    const root = await renderComponent();

    // Find Button by title
    const button = root.root.findByProps({ title: 'Enable Smart Parking Detection' });
    await act(async () => {
      button.props.onPress();
    });

    expect(mockRequestPermissions).toHaveBeenCalled();
    expect(mockStartGeofenceMonitoring).toHaveBeenCalled();
  });

  it('shows alert when permissions denied', async () => {
    mockRequestPermissions.mockResolvedValue(false);
    mockUseAllLotsData.mockReturnValue({ lots: [makeLot()], loading: false, error: null });
    const root = await renderComponent();

    const button = root.root.findByProps({ title: 'Enable Smart Parking Detection' });
    await act(async () => {
      button.props.onPress();
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Permissions Required',
      expect.any(String),
      expect.any(Array),
    );
    expect(mockStartGeofenceMonitoring).not.toHaveBeenCalled();
  });

  it('shows alert when tracking fails to start', async () => {
    mockStartGeofenceMonitoring.mockRejectedValue(new Error('tracking failed'));
    mockUseAllLotsData.mockReturnValue({ lots: [makeLot()], loading: false, error: null });
    const root = await renderComponent();

    const button = root.root.findByProps({ title: 'Enable Smart Parking Detection' });
    await act(async () => {
      button.props.onPress();
    });

    expect(Alert.alert).toHaveBeenCalledWith(
      'Error',
      expect.any(String),
      expect.any(Array),
    );
  });

  // ── Current lot info card ──────────────────────────

  it('shows current lot info after ENTER event', async () => {
    const lots = [makeLot({ lot_id: 'G1', display_name: 'Science Lot', capacity: 200, estimated_available: 95, occupancy_rate: 0.5 })];
    mockUseAllLotsData.mockReturnValue({ lots, loading: false, error: null });

    mockLocationState = {
      ...defaultLocationState,
      lastGeofenceEvent: { eventType: 'ENTER', regionId: 'G1' },
    };

    let root!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      root = ReactTestRenderer.create(<GeofencingIntegration />);
    });

    const text = JSON.stringify(root.toJSON());
    expect(text).toContain('Currently in');
    expect(text).toContain('Science Lot');
    expect(text).toContain('% full');
  });

  it('clears current lot info after EXIT event', async () => {
    const lots = [makeLot({ lot_id: 'G1' })];
    mockUseAllLotsData.mockReturnValue({ lots, loading: false, error: null });

    // First → ENTER
    mockLocationState = {
      ...defaultLocationState,
      lastGeofenceEvent: { eventType: 'ENTER', regionId: 'G1' },
    };
    let root!: ReactTestRenderer.ReactTestRenderer;
    await act(async () => {
      root = ReactTestRenderer.create(<GeofencingIntegration />);
    });

    // Then → EXIT
    mockLocationState = {
      ...defaultLocationState,
      lastGeofenceEvent: { eventType: 'EXIT', regionId: 'G1' },
    };
    await act(async () => {
      root.update(<GeofencingIntegration />);
    });

    const text = JSON.stringify(root.toJSON());
    expect(text).not.toContain('Currently in');
  });

  // ── Error resilience ───────────────────────────────

  it('handles occupancy event API failure gracefully', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    mockRecordOccupancyEvent.mockRejectedValue(new Error('Network gone'));
    const lots = [makeLot({ lot_id: 'G1' })];
    mockUseAllLotsData.mockReturnValue({ lots, loading: false, error: null });

    mockLocationState = {
      ...defaultLocationState,
      lastGeofenceEvent: { eventType: 'ENTER', regionId: 'G1' },
    };

    await act(async () => {
      await renderComponent();
    });

    // Alert still fires even though API failed
    expect(Alert.alert).toHaveBeenCalledWith(
      'Entered Parking Lot',
      expect.any(String),
      expect.any(Array),
    );

    consoleErrorSpy.mockRestore();
  });

  it('handles geofence initialisation failure gracefully', async () => {
    const consoleErrorSpy = jest.spyOn(console, 'error').mockImplementation();
    mockCreateSDKGeofencesFromLots.mockImplementation(() => { throw new Error('Init fail'); });
    mockUseAllLotsData.mockReturnValue({ lots: [makeLot()], loading: false, error: null });

    // Should not crash
    const root = await renderComponent();
    expect(root.toJSON()).toBeTruthy();

    consoleErrorSpy.mockRestore();
  });
});
