/**
 * ShuttleCallout Component Tests
 *
 * Tests the map callout functionality for shuttles:
 * - Basic rendering
 * - Passenger load percentage calculations and text outputs
 * - Edge cases (zero capacity)
 * - Accessibility labeling
 */
/* eslint-disable @typescript-eslint/no-explicit-any */

import React from 'react';
import { ShuttleCallout } from '../src/components/Map/ShuttleCallout'
import { collectTexts, hasText, createRenderer } from './testUtils';

// ────────────────────── Mocks ──────────────────────

jest.mock('react-native-maps', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    Callout: (props: any) => <View testID="callout" {...props} />,
  };
});

jest.mock('react-native-vector-icons/Ionicons', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  return (props: any) => <Text testID={`icon-${props.name}`} />;
});

// Mock the custom text component
jest.mock('../src/components/CustomText', () => ({
  Text: (props: any) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text: RNText } = require('react-native');
    return <RNText {...props} />;
  },
}));

// ────────────────────── Mock Data ──────────────────────

const mockColors = {
  backgroundLight: '#ffffff',
  shadowDark: '#000000',
  textPrimary: '#333333',
  darkGray: '#666666',
  borderLight: '#cccccc'
};

const baseShuttle = {
  id: 'shuttle-1',
  busName: 'Shuttle 42', 
  route: 'All Campus Express',
  routeId: 'route-1',
  paxLoad: 0,
  capacity: 40,
  latitude: 33.78,
  longitude: -118.11,
  heading: 90,
  color: '#ffffff'
};

// ────────────────────── Tests ──────────────────────

describe('ShuttleCallout', () => {
  const renderCallout = createRenderer(ShuttleCallout);

  it('renders correctly with basic shuttle data', () => {
    const renderer = renderCallout({ shuttle: baseShuttle, colors: mockColors as any });
    const texts = collectTexts(renderer.root);
    
    expect(hasText(texts, 'Shuttle 42')).toBe(true);
    expect(hasText(texts, 'All Campus Express')).toBe(true);
  });

  describe('Passenger Load Logic', () => {
    it('displays "Empty" when passenger load is low (0-19%)', () => {
      const shuttle = { ...baseShuttle, paxLoad: 5, capacity: 40 }; 
      const renderer = renderCallout({ shuttle, colors: mockColors as any });
      const texts = collectTexts(renderer.root);
      
      expect(hasText(texts, 'Empty')).toBe(true);
      expect(hasText(texts, '13%')).toBe(true);
      expect(hasText(texts, '5 / 40 passengers')).toBe(true);
    });

    it('displays "Not too crowded" for 20-49% capacity', () => {
      const shuttle = { ...baseShuttle, paxLoad: 15, capacity: 40 }; 
      const renderer = renderCallout({ shuttle, colors: mockColors as any });
      const texts = collectTexts(renderer.root);
      
      expect(hasText(texts, 'Not too crowded')).toBe(true);
      expect(hasText(texts, '38%')).toBe(true);
    });

    it('displays "Crowded" for 50-84% capacity', () => {
      const shuttle = { ...baseShuttle, paxLoad: 25, capacity: 40 }; 
      const renderer = renderCallout({ shuttle, colors: mockColors as any });
      const texts = collectTexts(renderer.root);
      
      expect(hasText(texts, 'Crowded')).toBe(true);
      expect(hasText(texts, '63%')).toBe(true);
    });

    it('displays "Very crowded" for 85%+ capacity', () => {
      const shuttle = { ...baseShuttle, paxLoad: 38, capacity: 40 }; 
      const renderer = renderCallout({ shuttle, colors: mockColors as any });
      const texts = collectTexts(renderer.root);
      
      expect(hasText(texts, 'Very crowded')).toBe(true);
      expect(hasText(texts, '95%')).toBe(true);
    });

    it('displays "Unknown" when capacity is 0 to avoid division by zero', () => {
      const shuttle = { ...baseShuttle, paxLoad: 10, capacity: 0 };
      const renderer = renderCallout({ shuttle, colors: mockColors as any });
      const texts = collectTexts(renderer.root);
      
      expect(hasText(texts, 'Unknown')).toBe(true);
      expect(hasText(texts, '0%')).toBe(true);
    });
  });

  describe('Accessibility', () => {
    it('sets the correct accessibility label for screen readers', () => {
      const shuttle = { ...baseShuttle, paxLoad: 20, capacity: 40 }; 
      const renderer = renderCallout({ shuttle, colors: mockColors as any });
      
      const cardView = renderer.root.findAllByProps({ accessible: true })[0];
      
      expect(cardView.props.accessibilityLabel).toBe(
        'Shuttle 42 on route All Campus Express. Occupancy: Crowded, 50 percent full.'
      );
    });
  });
});