/**
 * SegmentedCircle Component Tests
 *
 * Tests SVG rendering logic:
 * - Single color renders a plain circle (no pie slices)
 * - Multiple colors render the correct number of arc Path slices
 * - Each slice uses its corresponding color
 * - Default props (size, border) flow through to the SVG elements
 * - Empty color array falls back to white
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-require-imports */
import React from 'react';
import { SegmentedCircle } from '../src/components/Map/SegmentedCircle';
import { createRenderer } from './testUtils';

// ────────────────────── Mocks ──────────────────────

jest.mock('react-native-svg', () => {
  const { View } = require('react-native');
  return {
    Svg: ({ children, ...rest }: any) => <View testID="svg" {...rest}>{children}</View>,
    Circle: ({ children, ...rest }: any) => <View testID="circle" {...rest}>{children}</View>,
    Path: ({ children, ...rest }: any) => <View testID="path" {...rest}>{children}</View>,
  };
});

// ────────────────────── Tests ──────────────────────

describe('SegmentedCircle', () => {
  const render = createRenderer(SegmentedCircle);

  describe('Single color', () => {
    it('renders a plain circle with no Path slices', () => {
      const tree = render({ colors: ['#ff0000'] });
      const circles = tree.root.findAllByProps({ testID: 'circle' });
      const paths = tree.root.findAllByProps({ testID: 'path' });
      expect(circles.length).toBeGreaterThan(0);
      expect(paths).toHaveLength(0);
    });

    it('fills the circle with the provided color', () => {
      const tree = render({ colors: ['#4ade80'] });
      const filled = tree.root.findAllByProps({ testID: 'circle' })
        .find(c => c.props.fill === '#4ade80');
      expect(filled).toBeDefined();
    });

    it('falls back to white when colors array is empty', () => {
      const tree = render({ colors: [] });
      const filled = tree.root.findAllByProps({ testID: 'circle' })
        .find(c => c.props.fill === '#ffffff');
      expect(filled).toBeDefined();
    });
  });

  describe('Multiple colors', () => {
    // toJSON() reflects the rendered host tree (not fiber internals), giving
    // an accurate count of Path slices without fiber-traversal artifacts.
    const pathsFromJson = (tree: ReturnType<typeof render>) => {
      const json = tree.toJSON() as any;
      return (json?.children ?? []).filter((c: any) => c.props?.testID === 'path');
    };

    it('renders one Path slice per color for 2 colors', () => {
      const tree = render({ colors: ['#ff0000', '#00ff00'] });
      expect(pathsFromJson(tree)).toHaveLength(2);
    });

    it('renders one Path slice per color for 3 colors', () => {
      const tree = render({ colors: ['#ff0000', '#00ff00', '#0000ff'] });
      expect(pathsFromJson(tree)).toHaveLength(3);
    });

    it('each Path slice uses its corresponding color as fill', () => {
      const colors = ['#aaaaaa', '#bbbbbb', '#cccccc'];
      const tree = render({ colors });
      const fills = pathsFromJson(tree).map((c: any) => c.props.fill);
      expect(fills).toEqual(colors);
    });

    it('still renders the border circle overlay on top of slices', () => {
      const tree = render({ colors: ['#ff0000', '#00ff00'], borderColor: '#ffffff' });
      const border = tree.root.findAllByProps({ testID: 'circle' })
        .find(c => c.props.stroke === '#ffffff');
      expect(border).toBeDefined();
    });
  });

  describe('Size and border props', () => {
    it('passes the size prop to the Svg element', () => {
      const tree = render({ colors: ['#ff0000'], size: 40 });
      const svg = tree.root.findByProps({ testID: 'svg' });
      expect(svg.props.width).toBe(40);
      expect(svg.props.height).toBe(40);
    });

    it('applies custom border color to the stroke circle', () => {
      const tree = render({ colors: ['#ff0000'], borderColor: '#000000' });
      const border = tree.root.findAllByProps({ testID: 'circle' })
        .find(c => c.props.stroke === '#000000');
      expect(border).toBeDefined();
    });

    it('applies custom border width as strokeWidth', () => {
      const tree = render({ colors: ['#ff0000'], borderWidth: 4 });
      const border = tree.root.findAllByProps({ testID: 'circle' })
        .find(c => c.props.strokeWidth === 4);
      expect(border).toBeDefined();
    });
  });
});
