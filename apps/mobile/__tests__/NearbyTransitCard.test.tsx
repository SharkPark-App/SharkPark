/**
 * NearbyTransitCard Component Tests
 *
 * - Returns null when nearbyStops is empty
 * - Shows loading spinner per stop
 * - Shows "No upcoming arrivals" when arrivals is empty and not loading
 * - Renders route badge, name, and ETA string
 * - Groups multiple arrivals for the same route into one row
 * - Accessibility label format on each arrival row
 * - Renders multiple stops
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { render, screen } from '@testing-library/react-native';
import { NearbyTransitCard } from '../src/components/NearbyTransitCard';
import type { NearbyStopWithArrivals } from '../src/hooks/useNearbyStopETAs';

// ────────────────────── Mocks ──────────────────────

jest.mock('../src/components/CustomText', () => ({
  Text: ({ children, ...props }: any) => {
    const { Text: RNText } = require('react-native');
    return <RNText {...props}>{children}</RNText>;
  },
}));

// ────────────────────── Mock Data ──────────────────────

const mockColors = {
  white: '#ffffff',
  shadowDark: '#000000',
  borderLight: '#dddddd',
  textPrimary: '#333333',
  darkGray: '#888888',
  primary: '#1a73e8',
} as any;

const baseStop: NearbyStopWithArrivals = {
  stop: {
    id: 's1',
    name: 'Student Union',
    latitude: 33.78,
    longitude: -118.11,
    routeIds: ['r1'],
    color: '#ff0000',
  },
  arrivals: [],
  isLoading: false,
};

// ────────────────────── Tests ──────────────────────

describe('NearbyTransitCard', () => {
  it('returns null when nearbyStops is empty', () => {
    const { toJSON } = render(
      <NearbyTransitCard nearbyStops={[]} colors={mockColors} />
    );
    expect(toJSON()).toBeNull();
  });

  it('shows the stop name', () => {
    render(<NearbyTransitCard nearbyStops={[baseStop]} colors={mockColors} />);
    expect(screen.getByText('Student Union')).toBeTruthy();
  });

  it('shows a loading spinner when isLoading is true', () => {
    const loadingStop = { ...baseStop, isLoading: true };
    render(<NearbyTransitCard nearbyStops={[loadingStop]} colors={mockColors} />);
    expect(screen.getByLabelText('Loading arrival times')).toBeTruthy();
  });

  it('shows "No upcoming arrivals" when loaded but arrivals are empty', () => {
    render(<NearbyTransitCard nearbyStops={[baseStop]} colors={mockColors} />);
    expect(screen.getByText('No upcoming arrivals')).toBeTruthy();
  });

  it('renders route name and ETA text', () => {
    const stop: NearbyStopWithArrivals = {
      ...baseStop,
      arrivals: [
        { routeId: 'r1', routeName: 'East Loop', abbreviation: 'E', color: '#ffea3f', etaMinutes: 7 },
      ],
    };
    render(<NearbyTransitCard nearbyStops={[stop]} colors={mockColors} />);
    expect(screen.getByText('East Loop')).toBeTruthy();
    expect(screen.getByText('7 min')).toBeTruthy();
  });

  it('groups multiple arrivals for the same route into one row', () => {
    const stop: NearbyStopWithArrivals = {
      ...baseStop,
      arrivals: [
        { routeId: 'r1', routeName: 'East Loop', abbreviation: 'E', color: '#ffea3f', etaMinutes: 3 },
        { routeId: 'r1', routeName: 'East Loop', abbreviation: 'E', color: '#ffea3f', etaMinutes: 8 },
      ],
    };
    render(<NearbyTransitCard nearbyStops={[stop]} colors={mockColors} />);
    expect(screen.getByText('3, 8 min')).toBeTruthy();
  });

  it('sets the correct accessibility label on each arrival row', () => {
    const stop: NearbyStopWithArrivals = {
      ...baseStop,
      arrivals: [
        { routeId: 'r1', routeName: 'East Loop', abbreviation: 'E', color: '#ffea3f', etaMinutes: 7 },
      ],
    };
    render(<NearbyTransitCard nearbyStops={[stop]} colors={mockColors} />);
    expect(screen.getByLabelText('Route East Loop. 7 min.')).toBeTruthy();
  });

  it('renders multiple stops', () => {
    const stop2: NearbyStopWithArrivals = {
      stop: { id: 's2', name: 'Library', latitude: 33.79, longitude: -118.12, routeIds: ['r2'], color: '#00ff00' },
      arrivals: [],
      isLoading: false,
    };
    render(<NearbyTransitCard nearbyStops={[baseStop, stop2]} colors={mockColors} />);
    expect(screen.getByText('Student Union')).toBeTruthy();
    expect(screen.getByText('Library')).toBeTruthy();
  });
});
