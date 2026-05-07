import ReactTestRenderer from 'react-test-renderer';
import { HourlyChart } from '../src/components/HourlyChart';
import { collectTexts, hasText, createRenderer } from './testUtils';

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


// HourlyChart formats hours in America/Los_Angeles regardless of host tz, so
// these helpers must build / read hours in PT — otherwise tests fail on UTC CI.
const CAMPUS_TZ = 'America/Los_Angeles';

const ymdInTz = (d: Date) =>
  new Intl.DateTimeFormat('en-CA', {
    timeZone: CAMPUS_TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);

const ptOffset = (d: Date): string => {
  const part = new Intl.DateTimeFormat('en-US', {
    timeZone: CAMPUS_TZ,
    timeZoneName: 'shortOffset',
  })
    .formatToParts(d)
    .find(p => p.type === 'timeZoneName')?.value;
  const raw = (part ?? 'GMT-08:00').replace('GMT', '');
  const m = /^([+-])(\d{1,2})(?::(\d{2}))?$/.exec(raw);
  if (!m) return '-08:00';
  return `${m[1]}${m[2].padStart(2, '0')}:${m[3] ?? '00'}`;
};

function isoAt(hour: number): string {
  const now = new Date();
  const ymd = ymdInTz(now);
  const hh = String(hour).padStart(2, '0');
  return new Date(`${ymd}T${hh}:00:00${ptOffset(now)}`).toISOString();
}

const ptHourNow = (): number =>
  parseInt(
    new Intl.DateTimeFormat('en-US', {
      timeZone: CAMPUS_TZ,
      hour: 'numeric',
      hour12: false,
    }).format(new Date()),
    10,
  ) % 24;

/** Data at the current PT hour - triggers the status tooltip */
function currentHourData(occupancy: number, extra: object = {}) {
  return [{ time: isoAt(ptHourNow()), occupancy, ...extra }];
}

const nonCurrentHour = (ptHourNow() + 12) % 24;

const render = createRenderer(HourlyChart);

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
    expect(hasText(texts, 'Hourly Forecast')).toBe(true);
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

describe('HourlyChart -- bar accessibility', () => {
  it('bar overlays have accessibilityRole="button"', () => {
    const tree = render({ data: [{ time: isoAt(3), occupancy: 50 }] });
    const bars = tree.root.findAll(
      node => node.props.accessibilityRole === 'button' && node.props.accessible === true,
    );
    expect(bars.length).toBeGreaterThan(0);
  });

  it('bar accessibility label includes time, occupancy percentage and status', () => {
    const tree = render({ data: [{ time: isoAt(3), occupancy: 60 }] });
    const bar = tree.root.find(
      node => node.props.accessibilityRole === 'button' && node.props.accessible === true,
    );
    expect(bar.props.accessibilityLabel).toContain('3a');
    expect(bar.props.accessibilityLabel).toContain('60 percent');
    expect(bar.props.accessibilityLabel).toContain('Filling');
  });

  it('current hour bar label includes "current hour" label and value', () => {
    const hour = ptHourNow();
    const expectedTime = hour === 0 ? '12a' : hour < 12 ? `${hour}a` : hour === 12 ? '12p' : `${hour - 12}p`;
    const tree = render({ data: currentHourData(60) });
    const bar = tree.root.find(
      node => node.props.accessibilityRole === 'button' && node.props.accessible === true,
    );
    expect(bar.props.accessibilityLabel).toContain('current hour');
    expect(bar.props.accessibilityLabel).toContain(expectedTime);
    expect(bar.props.accessibilityLabel).toContain('60 percent');
  });
  
  it('current hour bar starts selected', () => {
    const tree = render({ data: currentHourData(60) });
    const bar = tree.root.find(
      node => node.props.accessibilityRole === 'button' && node.props.accessible === true,
    );
    expect(bar.props.accessibilityState).toMatchObject({ selected: true });
  });

  it('non-current bar starts unselected', () => {
    const tree = render({ data: [{ time: isoAt(nonCurrentHour), occupancy: 50 }] });
    const bar = tree.root.find(
      node => node.props.accessibilityRole === 'button' && node.props.accessible === true,
    );
    expect(bar.props.accessibilityState).toMatchObject({ selected: false });
  });

  it('pressing a bar selects it', () => {
    const tree = render({ data: [{ time: isoAt(nonCurrentHour), occupancy: 50 }] });
    const bar = tree.root.find(
      node => node.props.accessibilityRole === 'button' && node.props.accessible === true,
    );

    ReactTestRenderer.act(() => { bar.props.onPress(); });
    const barAfter = tree.root.find(
      node => node.props.accessibilityRole === 'button' && node.props.accessible === true,
    );
    expect(barAfter.props.accessibilityState).toMatchObject({ selected: true });
  });

  it('unselected bar accessibility hint says "view details"', () => {
    const tree = render({ data: [{ time: isoAt(nonCurrentHour), occupancy: 50 }] });
    const bar = tree.root.find(
      node => node.props.accessibilityRole === 'button' && node.props.accessible === true,
    );
    expect(bar.props.accessibilityHint).toContain('view details');
  });

  it('selected bar hint says "deselect"', () => {
    const tree = render({ data: currentHourData(60) });
    const bar = tree.root.find(
      node => node.props.accessibilityRole === 'button' && node.props.accessible === true,
    );
    expect(bar.props.accessibilityHint).toContain('deselect');
  });

  // Prevents the raw chart's unlabeled elements from being exposed to screen readers
  it('BarChart is hidden from the accessibility tree', () => {
    const tree = render({ data: [{ time: isoAt(3), occupancy: 50 }] });
    const hidden = tree.root.find(
      node => node.props.accessibilityElementsHidden === true,
    );
    expect(hidden).toBeTruthy();
  });
});

describe('HourlyChart -- tooltip accessibility', () => {
  it('tooltip has accessible live region', () => {
    const tree = render({ data: currentHourData(60) });
    const tooltip = tree.root.find(
      node => node.props.accessibilityLiveRegion === 'polite',
    );
    expect(tooltip.props.accessible).toBe(true);
  });

  it('tooltip label includes current status', () => {
    const tree = render({ data: currentHourData(60) });
    const tooltip = tree.root.find(
      node => node.props.accessibilityLiveRegion === 'polite',
    );
    expect(tooltip.props.accessibilityLabel).toContain('Filling');
  });

  it('tooltip label includes confidence range when bounds provided', () => {
    const tree = render({ data: currentHourData(60, { lowerBound: 50, upperBound: 70 }) });
    const tooltip = tree.root.find(
      node => node.props.accessibilityLiveRegion === 'polite',
    );
    expect(tooltip.props.accessibilityLabel).toContain('50');
    expect(tooltip.props.accessibilityLabel).toContain('70');
  });

  it('empty state container has accessibilityLabel', () => {
    const tree = render({ data: [] });
    const emptyState = tree.root.find(
      node => node.props.accessibilityLabel === 'No forecast data available' && node.props.accessible === true,
    );
    expect(emptyState).toBeTruthy();
  });
});
