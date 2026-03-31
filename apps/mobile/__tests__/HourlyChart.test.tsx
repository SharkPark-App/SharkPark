import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { HourlyChart } from '../src/components/HourlyChart';

// ────────────────────── Mocks ──────────────────────

jest.mock('../src/context/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      primary: '#EBA91B',
      white: '#ffffff',
      black: '#1f2937',
      gray: '#6b7280',
      darkGray: '#374151',
      mediumLightGray: '#d1d5db',
      borderGray: '#e5e7eb',
      textPrimary: '#111827',
      shadowDark: '#000',
    },
    isDark: false,
  }),
}));

jest.mock('react-native-gifted-charts', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const r = require('react');
  return {
    BarChart: ({ data }: { data: { label?: string }[] }) =>
      // Expose bar labels so we can assert formatTime output
      r.createElement(
        'View',
        null,
        ...data.map((item: { label?: string }, i: number) => 
          item.label ? r.createElement('Text', { key: i }, item.label) : null,
        ),
      ),
  };
});

// ────────────────────── Helpers ──────────────────────

/** Collect all string leaves from the rendered tree */
function collectTexts(instance: ReactTestRenderer.ReactTestInstance): string[] {
  const texts: string[] = [];
  const walk = (node: ReactTestRenderer.ReactTestInstance) => {
    if (typeof node === 'string') return;
    if ((node.type as string) === 'Text') {
      const gather = (
        children: ReactTestRenderer.ReactTestInstance['children'],
      ) => {
        (children ?? []).forEach(child => {
          if (typeof child === 'string') texts.push(child);
          else gather(child.children);
        });
      };
      gather(node.children);
      return;
    }
    (node.children ?? []).forEach(child => {
      if (typeof child !== 'string') walk(child);
    });
  };
  walk(instance);
  return texts;
}

function hasText(texts: string[], substr: string): boolean {
  return texts.some(t => t.includes(substr));
}

/** Build an ISO timestamp for today at the given hour */
function isoAt(hour: number): string {
  const d = new Date();
  d.setHours(hour, 0, 0, 0);
  return d.toISOString();
}

/** Data at the current hour - triggers the status tooltip */
function currentHourData(occupancy: number, extra: object = {}) {
  return [{ time: isoAt(new Date().getHours()), occupancy, ...extra }];
}

function render(props: React.ComponentProps<typeof HourlyChart>) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<HourlyChart {...props} />);
  });
  return tree;
}

// ────────────────────── Tests ──────────────────────

describe('HourlyChart -- empty state', () => {
  it('renders "No forecast data available" when there is no data.', () => {
    const tree = render({ data: [] });
    const texts = collectTexts(tree.root);
    expect(hasText(texts, 'No forecast data available')).toBe(true);
  });
});

describe('HourlyChart -- title', () => {
  it('shows default title when name is not provided', () => {
    const tree = render({ data: [] });
    const texts = collectTexts(tree.root);
    expect(hasText(texts, 'Parking Occupancy Outlook')).toBe(true);
  });

  it('shows custom name when provided', () => {
    const tree = render({ data: [], name: 'Lot G6 Forecast' });
    const texts = collectTexts(tree.root);
    expect(hasText(texts, 'Lot G6 Forecast')).toBe(true);
  });
});

describe('HourlyChart -- time labels', () => {
  it('formats AM hours as "<h>a"', () => {
    const tree = render({ data: [{ time: isoAt(7), occupancy: 10 }] });
    expect(hasText(collectTexts(tree.root), '7a')).toBe(true);
  });

  it('formats noon (hour 12) as "12p"', () => {
    const tree = render({ data: [{ time: isoAt(12), occupancy: 10 }] });
    expect(hasText(collectTexts(tree.root), '12p')).toBe(true);
  });

  it('formats PM hours as "<h-12>p"', () => {
    const tree = render({ data: [{ time: isoAt(17), occupancy: 10 }] });
    expect(hasText(collectTexts(tree.root), '5p')).toBe(true);
  });

  it('returns empty string for an invalid time', () => {
    const tree = render({ data: [{ time: 'not-a-date', occupancy: 10 }] });
    expect(hasText(collectTexts(tree.root), 'not-a-date')).toBe(false);
  });
});

describe('HourlyChart -- status tooltip', () => {
  it('shows "Full" when occupancy >= 95', () => {
    const tree = render({ data: currentHourData(95) });
    expect(hasText(collectTexts(tree.root), 'Full')).toBe(true);
  });

  it('shows "Nearly Full" when occupancy >= 75 and < 95', () => {
    const tree = render({ data: currentHourData(80) });
    expect(hasText(collectTexts(tree.root), 'Nearly Full')).toBe(true);
  });

  it('shows "Filling" when occupancy >= 50 and < 75', () => {
    const tree = render({ data: currentHourData(60) });
    expect(hasText(collectTexts(tree.root), 'Filling')).toBe(true);
  });

  it('shows "Available" when occupancy < 50', () => {
    const tree = render({ data: currentHourData(30) });
    expect(hasText(collectTexts(tree.root), 'Available')).toBe(true);
  });

  it('shows "Full" at the boundary value of 100', () => {
    const tree = render({ data: currentHourData(100) });
    expect(hasText(collectTexts(tree.root), 'Full')).toBe(true);
  });

  it('shows "Nearly Full" at the boundary value of 75', () => {
    const tree = render({ data: currentHourData(75) });
    expect(hasText(collectTexts(tree.root), 'Nearly Full')).toBe(true);
  });
});

describe('HourlyChart -- confidence interval', () => {
  it('shows expected range when both bounds are provided', () => {
    const tree = render({
      data: currentHourData(60, { lowerBound: 55, upperBound: 65 }),
    });
    const texts = collectTexts(tree.root);
    expect(hasText(texts, 'Expected Range:')).toBe(true);
    expect(hasText(texts, '55')).toBe(true);
    expect(hasText(texts, '65')).toBe(true);
  });

  it('hides expected range when bounds are absent', () => {
    const tree = render({ data: currentHourData(60) });
    expect(hasText(collectTexts(tree.root), 'Expected Range:')).toBe(false);
  });

  it('hides expected range when only one bound is provided', () => {
    const tree = render({
      data: currentHourData(60, { lowerBound: 55 }),
    });
    expect(hasText(collectTexts(tree.root), 'Expected Range:')).toBe(false);
  });
});
