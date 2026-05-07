/**
 * ShuttleModal Component Tests
 *
 * Tests the bottom-sheet modal for live shuttle details:
 * - Renders null when no shuttle is provided
 * - Renders null when visible=false
 * - Displays shuttle name, route, and passenger load
 * - Passenger load percentage thresholds (Empty / Not crowded / etc.)
 * - capacity=0 fallback shows "Unknown"
 * - Close button accessibility label and press handler
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { render, screen, fireEvent } from '@testing-library/react-native';
import { ShuttleModal } from '../src/components/Modals/ShuttleModal';

// ────────────────────── Mocks ──────────────────────

jest.mock('../src/components/CustomText', () => ({
  Text: ({ children, ...props }: any) => {
    const { Text: RNText } = require('react-native');
    return <RNText {...props}>{children}</RNText>;
  },
}));

// ────────────────────── Mock Data ──────────────────────

const mockColors = {
  primary: '#1a73e8',
  white: '#ffffff',
  backgroundLight: '#f5f5f5',
  shadowDark: '#000000',
  textPrimary: '#333333',
  darkGray: '#888888',
  borderLight: '#dddddd',
} as any;

const baseShuttle = {
  id: 'sh1',
  busName: 'Beach City',
  route: 'All Campus Express',
  routeId: 'r1',
  color: '#4ade80',
  latitude: 33.78,
  longitude: -118.11,
  heading: 0,
  paxLoad: 0,
  capacity: 30,
};

// ────────────────────── Tests ──────────────────────

describe('ShuttleModal', () => {
  it('renders null when shuttle is null', () => {
    const { toJSON } = render(
      <ShuttleModal visible={true} onClose={jest.fn()} shuttle={null} colors={mockColors} />
    );
    expect(toJSON()).toBeNull();
  });

  it('does not show content when not visible', () => {
    render(
      <ShuttleModal visible={false} onClose={jest.fn()} shuttle={baseShuttle} colors={mockColors} />
    );
    expect(screen.queryByText('Beach City')).toBeNull();
  });

  it('displays the shuttle bus name', () => {
    render(
      <ShuttleModal visible={true} onClose={jest.fn()} shuttle={baseShuttle} colors={mockColors} />
    );
    expect(screen.getByText('Beach City')).toBeTruthy();
  });

  it('displays the route name', () => {
    render(
      <ShuttleModal visible={true} onClose={jest.fn()} shuttle={baseShuttle} colors={mockColors} />
    );
    expect(screen.getByText('All Campus Express')).toBeTruthy();
  });

  it('has a close button with correct accessibility label', () => {
    render(
      <ShuttleModal visible={true} onClose={jest.fn()} shuttle={baseShuttle} colors={mockColors} />
    );
    expect(screen.getByLabelText('Close shuttle details')).toBeTruthy();
  });

  it('calls onClose when the close button is pressed', () => {
    const onClose = jest.fn();
    render(
      <ShuttleModal visible={true} onClose={onClose} shuttle={baseShuttle} colors={mockColors} />
    );
    fireEvent.press(screen.getByLabelText('Close shuttle details'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  describe('Passenger load thresholds', () => {
    const cases: [string, number, number, string][] = [
      ['Empty',            0,  30, 'Empty'],
      ['Not crowded',      4,  30, 'Not crowded'],     // 13%
      ['Not too crowded', 10,  30, 'Not too crowded'], // 33%
      ['Crowded',         18,  30, 'Crowded'],          // 60%
      ['Very crowded',    27,  30, 'Very crowded'],     // 90%
    ];

    test.each(cases)('%s (%i/%i passengers)', (_label, paxLoad, capacity, expected) => {
      render(
        <ShuttleModal
          visible={true}
          onClose={jest.fn()}
          shuttle={{ ...baseShuttle, paxLoad, capacity }}
          colors={mockColors}
        />
      );
      expect(screen.getByText(new RegExp(expected))).toBeTruthy();
    });

    it('shows "Unknown" when capacity is 0', () => {
      render(
        <ShuttleModal
          visible={true}
          onClose={jest.fn()}
          shuttle={{ ...baseShuttle, paxLoad: 0, capacity: 0 }}
          colors={mockColors}
        />
      );
      expect(screen.getByText('Unknown')).toBeTruthy();
    });

    it('shows pax / capacity count when capacity is known', () => {
      render(
        <ShuttleModal
          visible={true}
          onClose={jest.fn()}
          shuttle={{ ...baseShuttle, paxLoad: 10, capacity: 30 }}
          colors={mockColors}
        />
      );
      expect(screen.getByText('10 / 30 passengers')).toBeTruthy();
    });
  });
});
