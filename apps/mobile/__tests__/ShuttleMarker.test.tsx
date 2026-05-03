/**
 * ShuttleMarker Component Tests
 *
 * Tests the map marker functionality for live shuttles:
 * - Basic rendering
 * - Rotation logic (marker heading vs icon counter-rotation)
 * - Color fallbacks
 * - Accessibility labels
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import { StyleSheet } from 'react-native';
import { ShuttleMarker } from '../src/components/Map/ShuttleMarker';
import { createRenderer } from './testUtils';

// ────────────────────── Mocks ──────────────────────

jest.mock('react-native-maps', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  return {
    Marker: (props: any) => <View testID="marker" {...props}>{props.children}</View>,
  };
});

jest.mock('react-native-vector-icons/Ionicons', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { Text } = require('react-native');
  return (props: any) => <Text testID={`icon-${props.name}`} {...props} />;
});

// ────────────────────── Mock Data ──────────────────────

const mockColors = {
  white: '#ffffff',
  shadowDark: '#000000',
  // include other theme colors if needed by TS, but these are the ones used
} as any;

const baseShuttle = {
  id: 'shuttle-1',
  busName: 'Beach City', 
  route: 'All Campus Express',
  routeId: 'route-1',
  paxLoad: 15,
  capacity: 40,
  latitude: 33.78,
  longitude: -118.11,
  heading: 90,
  color: '#4ade80',
};

// ────────────────────── Tests ──────────────────────

describe('ShuttleMarker', () => {
  const renderMarker = createRenderer(ShuttleMarker);

  it('renders without crashing and passes correct coordinates to Marker', () => {
    const renderer = renderMarker({ shuttle: baseShuttle, colors: mockColors });
    
    // Find the Marker component
    const marker = renderer.root.findByProps({ testID: 'marker' });
    
    expect(marker.props.coordinate).toEqual({
      latitude: 33.78,
      longitude: -118.11
    });
  });

  describe('Rotation Logic', () => {
    it('applies the correct heading rotation to the main container', () => {
      const renderer = renderMarker({ shuttle: baseShuttle, colors: mockColors });
      
      // The container is the first (and only) view inside the Marker,
      // holding the arrow and circle.
      const marker = renderer.root.findByProps({ testID: 'marker' });
      const containerView = Array.isArray(marker.props.children)
        ? marker.props.children[0]
        : marker.props.children;
      
      const flatStyle = StyleSheet.flatten(containerView.props.style);
      expect(flatStyle.transform).toEqual([{ rotate: '90deg' }]);
    });

    it('applies the correct counter-rotation to the icon so it stays upright', () => {
      const renderer = renderMarker({ shuttle: baseShuttle, colors: mockColors });
      
      const icon = renderer.root.findByProps({ testID: 'icon-bus' });
      const flatStyle = StyleSheet.flatten(icon.props.style);
      
      expect(flatStyle.transform).toEqual([{ rotate: '-90deg' }]);
    });

    it('defaults to 0 degrees if heading is not provided', () => {
      const shuttleNoHeading = { ...baseShuttle, heading: undefined };
      const renderer = renderMarker({ shuttle: shuttleNoHeading, colors: mockColors });
      
      const icon = renderer.root.findByProps({ testID: 'icon-bus' });
      const flatStyle = StyleSheet.flatten(icon.props.style);
      
      expect(flatStyle.transform).toEqual([{ rotate: '-0deg' }]); // -0deg is standard JS evaluation of -heading when heading=0
    });
  });

  describe('Styling and Fallbacks', () => {
    it('uses the shuttle color when provided', () => {
      const renderer = renderMarker({ shuttle: baseShuttle, colors: mockColors });
      
      // The arrow uses borderBottomColor, the circle uses backgroundColor
      const views = renderer.root.findAllByType('View' as any);
      
      // Find the arrow view (has borderBottomWidth: 10 in styles)
      const arrowView = views.find(v => {
        const style = StyleSheet.flatten(v.props.style);
        return style && style.borderBottomWidth === 10;
      });
      
      const arrowStyle = StyleSheet.flatten(arrowView?.props.style);
      expect(arrowStyle.borderBottomColor).toBe('#4ade80');
    });

    it('falls back to colors.white if shuttle.color is undefined', () => {
      const shuttleNoColor = { ...baseShuttle, color: undefined };
      const renderer = renderMarker({ shuttle: shuttleNoColor, colors: mockColors });
      
      const views = renderer.root.findAllByType('View' as any);
      const arrowView = views.find(v => {
        const style = StyleSheet.flatten(v.props.style);
        return style && style.borderBottomWidth === 10;
      });
      
      const arrowStyle = StyleSheet.flatten(arrowView?.props.style);
      expect(arrowStyle.borderBottomColor).toBe('#ffffff'); // Default fallback
    });
  });

  describe('Nested Components and Accessibility', () => {
    it('sets the correct accessibility label for screen readers', () => {
      const renderer = renderMarker({ shuttle: baseShuttle, colors: mockColors });
      
      const marker = renderer.root.findByProps({ testID: 'marker' });
      
      expect(marker.props.accessibilityLabel).toBe(
        'Shuttle: Beach City on route All Campus Express'
      );
    });
  });
});