import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import {
  LotFilterModal,
  matchesAttributes,
  ATTRIBUTE_FILTERS,
  type LotSummary,
} from '../src/components/Modals/FilterModal';
import { collectTexts, hasText } from './testUtils';

// ────────────────────── Mocks ──────────────────────

jest.mock('../src/context/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      primary: '#ffffff',
      white: '#ffffff',
      black: '#ffffff',
      gray: '#ffffff',
      mediumGray: '#ffffff',
      darkGray: '#ffffff',
      lightGray: '#ffffff',
      borderGray: '#ffffff',
      textPrimary: '#ffffff',
    },
    spacing: {
      xs: 2, sm: 4, md: 8, lg: 12, xl: 16, xxl: 24, xxxl: 32,
    },
    typography: {
      fontSize: { xs: 10, sm: 12, md: 14, lg: 16, xl: 18, xxl: 24 },
      fontFamily: { regular: 'System', medium: 'System', semibold: 'System', bold: 'System' },
    },
    isDark: false,
  }),
}));

jest.mock('../src/components/CustomText', () => ({
  Text: 'Text',
}));

// ────────────────────── Helpers ──────────────────────

const mockLots = [
  { lot_id: 'G1', lot_type: 'STUDENT' as const },
  { lot_id: 'G2', lot_type: 'STUDENT' as const },
  { lot_id: 'E1', lot_type: 'EMPLOYEE' as const },
];

const defaultProps = {
  isOpen: true,
  onClose: jest.fn(),
  lots: mockLots as LotSummary[],
  selectedLots: [] as string[],
  onApplyFilter: jest.fn(),
  routes: [] as { id: string; name: string; shortName: string; color: string; status: string; coordinates: [] }[],
  hiddenRouteIds: [] as string[],
  onApplyTransitFilter: jest.fn(),
  selectedAttributes: [] as string[],
  onApplyAttributeFilter: jest.fn(),
};

function render(props = defaultProps) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<LotFilterModal {...props} />);
  });
  // Fire layout so the paginated scroll area renders (native measurement
  // doesn't run in ReactTestRenderer — pageWidth/pageHeight stay 0 otherwise).
  ReactTestRenderer.act(() => {
    const wrapper = tree.root.findAll(node => typeof node.props.onLayout === 'function')[0];
    wrapper?.props.onLayout({ nativeEvent: { layout: { width: 300, height: 400 } } });
  });
  return tree;
}

// ────────────────────── Tests ──────────────────────

describe('LotFilterModal -- rendering', () => {
  it('renders without crashing when open', () => {
    const tree = render();
    expect(tree.toJSON()).toBeTruthy();
  });

  it('renders General Lot section', () => {
    const tree = render();
    expect(hasText(collectTexts(tree.root), 'General Lot')).toBe(true);
  });

  it('renders Employee Lot section', () => {
    const tree = render();
    expect(hasText(collectTexts(tree.root), 'Employee Lot')).toBe(true);
  });
});

describe('LotFilterModal -- close button accessibility', () => {
  it('close button has correct accessibilityRole and label', () => {
    const tree = render();
    const closeBtn = tree.root.find(
      node =>
        node.props.accessibilityRole === 'button' &&
        node.props.accessibilityLabel === 'Close filter modal',
    );
    expect(closeBtn).toBeTruthy();
  });

  it('calls onClose when close button is pressed', () => {
    const onClose = jest.fn();
    const tree = render({ ...defaultProps, onClose });
    const closeBtn = tree.root.find(
      node =>
        node.props.accessibilityRole === 'button' &&
        node.props.accessibilityLabel === 'Close filter modal',
    );
    ReactTestRenderer.act(() => {
      closeBtn.props.onPress();
    });
    expect(onClose).toHaveBeenCalled();
  });
});

describe('LotFilterModal -- lot checkbox accessibility', () => {
  it('lot buttons have accessibilityRole="checkbox"', () => {
    const tree = render();
    const checkboxes = tree.root.findAll(
      node => node.props.accessibilityRole === 'checkbox',
    );
    expect(checkboxes.length).toBeGreaterThan(0);
  });

  it('unselected lots have accessibilityState checked=false', () => {
    const tree = render({ ...defaultProps, selectedLots: [] });
    const checkboxes = tree.root.findAll(
      node => node.props.accessibilityRole === 'checkbox',
    );
    expect(checkboxes.length).toBeGreaterThan(0);
    checkboxes.forEach(cb => {
      expect(cb.props.accessibilityState).toMatchObject({ checked: false });
    });
  });

  it('selected lots have accessibilityState checked=true', () => {
    const tree = render({ ...defaultProps, selectedLots: ['G1'] });
    const g1 = tree.root.find(
      node =>
        node.props.accessibilityRole === 'checkbox' &&
        node.props.accessibilityLabel?.match(/\bG1\b/),
    );
    expect(g1.props.accessibilityState).toMatchObject({ checked: true });
  });

  it('unselected lot label starts with "Select"', () => {
    const tree = render({ ...defaultProps, selectedLots: [] });
    const g1 = tree.root.find(
      node =>
        node.props.accessibilityRole === 'checkbox' &&
        node.props.accessibilityLabel?.match(/\bG1\b/),
    );
    expect(g1.props.accessibilityLabel).toMatch(/^Select/);
  });

  it('selected lot label starts with "Deselect"', () => {
    const tree = render({ ...defaultProps, selectedLots: ['G1'] });
    const g1 = tree.root.find(
      node =>
        node.props.accessibilityRole === 'checkbox' &&
        node.props.accessibilityLabel?.match(/\bG1\b/),
    );
    expect(g1.props.accessibilityLabel).toMatch(/^Deselect/);
  });

  it('toggles lot selection on press', () => {
    const tree = render({ ...defaultProps, selectedLots: [] });
    const g1 = tree.root.find(
      node =>
        node.props.accessibilityRole === 'checkbox' &&
        node.props.accessibilityLabel?.match(/\bG1\b/),
    );
    ReactTestRenderer.act(() => {
      g1.props.onPress();
    });
    
    const g1After = tree.root.find(
      node =>
        node.props.accessibilityRole === 'checkbox' &&
        node.props.accessibilityLabel?.match(/\bG1\b/),
    );
    expect(g1After.props.accessibilityState).toMatchObject({ checked: true });
  });
});

describe('LotFilterModal -- footer buttons', () => {
  it('shows "Select All" when nothing is selected', () => {
    const tree = render({ ...defaultProps, selectedLots: [] });
    const btn = tree.root.find(
      node => node.props.accessibilityLabel === 'Select All',
    );
    expect(btn).toBeTruthy();
  });

  it('shows "Clear All" when every lot is selected', () => {
    const tree = render({ ...defaultProps, selectedLots: ['G1', 'G2', 'E1'] });
    const btn = tree.root.find(
      node => node.props.accessibilityLabel === 'Clear All',
    );
    expect(btn).toBeTruthy();
  });

  it('still shows "Select All" when only some lots are selected', () => {
    const tree = render({ ...defaultProps, selectedLots: ['G1'] });
    const btn = tree.root.find(
      node => node.props.accessibilityLabel === 'Select All',
    );
    expect(btn).toBeTruthy();
  });

  it('apply button has correct accessibility attributes', () => {
    const tree = render();
    const applyBtn = tree.root.find(
      node => node.props.accessibilityLabel === 'Apply filters',
    );
    expect(applyBtn.props.accessibilityRole).toBe('button');
  });

  it('calls onApplyFilter and onClose when apply is pressed', () => {
    const onApplyFilter = jest.fn();
    const onClose = jest.fn();
    const tree = render({ ...defaultProps, onApplyFilter, onClose });
    const applyBtn = tree.root.find(
      node => node.props.accessibilityLabel === 'Apply filters',
    );
    ReactTestRenderer.act(() => {
      applyBtn.props.onPress();
    });

    expect(onApplyFilter).toHaveBeenCalledWith([]);
    expect(onClose).toHaveBeenCalled();
  });

  it('select all selects every lot', () => {
    const tree = render({ ...defaultProps, selectedLots: [] });
    const selectAllBtn = tree.root.find(
      node => node.props.accessibilityLabel === 'Select All',
    );
    ReactTestRenderer.act(() => {
      selectAllBtn.props.onPress();
    });
    const checkboxes = tree.root.findAll(
      node => node.props.accessibilityRole === 'checkbox',
    );
    expect(checkboxes.length).toBeGreaterThan(0);
    checkboxes.forEach(cb => {
      expect(cb.props.accessibilityState).toMatchObject({ checked: true });
    });
  });
});

// ────────────────────── Attribute filter chips ──────────────────────

const attrLots = [
  // G1: EV + accessible
  {
    lot_id: 'G1',
    lot_type: 'STUDENT' as const,
    ev_charging_stations: 4,
    accessible_spaces: 2,
    motorcycle_spaces: 0,
    short_term_parking_spaces: 0,
    daily_permit_allowed: true,
    park_mobile_zones: ['3993'],
    is_covered: false,
  },
  // G2: nothing
  {
    lot_id: 'G2',
    lot_type: 'STUDENT' as const,
    ev_charging_stations: 0,
    accessible_spaces: 0,
    motorcycle_spaces: 0,
    short_term_parking_spaces: 0,
    daily_permit_allowed: false,
    park_mobile_zones: [],
    is_covered: false,
  },
  // E1: EV only
  {
    lot_id: 'E1',
    lot_type: 'EMPLOYEE' as const,
    ev_charging_stations: 2,
    accessible_spaces: 0,
    motorcycle_spaces: 0,
    short_term_parking_spaces: 0,
    daily_permit_allowed: false,
    park_mobile_zones: [],
    is_covered: false,
  },
];

describe('LotFilterModal -- attribute chips', () => {
  it('renders an EV charging chip', () => {
    const tree = render({ ...defaultProps, lots: attrLots });
    const chip = tree.root.find(
      node =>
        node.props.accessibilityRole === 'button' &&
        node.props.accessibilityLabel === 'Enable EV charging filter',
    );
    expect(chip).toBeTruthy();
  });

  it('activating EV chip dims lots without EV chargers', () => {
    const tree = render({ ...defaultProps, lots: attrLots });
    const evChip = tree.root.find(
      node => node.props.accessibilityLabel === 'Enable EV charging filter',
    );
    ReactTestRenderer.act(() => evChip.props.onPress());

    const g2 = tree.root.find(
      node =>
        node.props.accessibilityRole === 'checkbox' &&
        node.props.accessibilityLabel?.match(/\bG2\b/),
    );
    expect(g2.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('Apply forwards active attributes via onApplyAttributeFilter', () => {
    const onApplyAttributeFilter = jest.fn();
    const tree = render({
      ...defaultProps,
      lots: attrLots,
      onApplyAttributeFilter,
    });
    const evChip = tree.root.find(
      node => node.props.accessibilityLabel === 'Enable EV charging filter',
    );
    ReactTestRenderer.act(() => evChip.props.onPress());

    const applyBtn = tree.root.find(
      node => node.props.accessibilityLabel === 'Apply filters',
    );
    ReactTestRenderer.act(() => applyBtn.props.onPress());

    expect(onApplyAttributeFilter).toHaveBeenCalledWith(['ev']);
  });

  it('hydrates from selectedAttributes prop', () => {
    const tree = render({
      ...defaultProps,
      lots: attrLots,
      selectedAttributes: ['ev'],
    });
    const evChip = tree.root.find(
      node => node.props.accessibilityLabel === 'Disable EV charging filter',
    );
    expect(evChip.props.accessibilityState).toMatchObject({ selected: true });
  });
});

describe('LotFilterModal -- section select-all / clear', () => {
  it('section Select all selects only that section\'s lots', () => {
    const tree = render({ ...defaultProps, lots: attrLots, selectedLots: [] });
    const selectGeneral = tree.root.find(
      node => node.props.accessibilityLabel === 'Select all general lot lots',
    );
    ReactTestRenderer.act(() => selectGeneral.props.onPress());

    const g1 = tree.root.find(
      node =>
        node.props.accessibilityRole === 'checkbox' &&
        node.props.accessibilityLabel?.match(/\bG1\b/),
    );
    const e1 = tree.root.find(
      node =>
        node.props.accessibilityRole === 'checkbox' &&
        node.props.accessibilityLabel?.match(/\bE1\b/),
    );
    expect(g1.props.accessibilityState).toMatchObject({ checked: true });
    expect(e1.props.accessibilityState).toMatchObject({ checked: false });
  });

  it('section Clear removes only that section\'s lots from selection', () => {
    const tree = render({
      ...defaultProps,
      lots: attrLots,
      selectedLots: ['G1', 'G2', 'E1'],
    });
    const clearGeneral = tree.root.find(
      node => node.props.accessibilityLabel === 'Clear general lot lot selection',
    );
    ReactTestRenderer.act(() => clearGeneral.props.onPress());

    const g1 = tree.root.find(
      node =>
        node.props.accessibilityRole === 'checkbox' &&
        node.props.accessibilityLabel?.match(/\bG1\b/),
    );
    const e1 = tree.root.find(
      node =>
        node.props.accessibilityRole === 'checkbox' &&
        node.props.accessibilityLabel?.match(/\bE1\b/),
    );
    expect(g1.props.accessibilityState).toMatchObject({ checked: false });
    expect(e1.props.accessibilityState).toMatchObject({ checked: true });
  });

  it('section Select all with active attribute filter skips dimmed lots', () => {
    const tree = render({
      ...defaultProps,
      lots: attrLots,
      selectedAttributes: ['ev'],
      selectedLots: [],
    });
    const selectGeneral = tree.root.find(
      node => node.props.accessibilityLabel === 'Select all general lot lots',
    );
    ReactTestRenderer.act(() => selectGeneral.props.onPress());

    const g1 = tree.root.find(
      node =>
        node.props.accessibilityRole === 'checkbox' &&
        node.props.accessibilityLabel?.match(/\bG1\b/),
    );
    const g2 = tree.root.find(
      node =>
        node.props.accessibilityRole === 'checkbox' &&
        node.props.accessibilityLabel?.match(/\bG2\b/),
    );
    expect(g1.props.accessibilityState).toMatchObject({ checked: true });
    expect(g2.props.accessibilityState).toMatchObject({ checked: false });
  });

  it('parking section "Select all" is disabled when every section lot is already selected', () => {
    const tree = render({
      ...defaultProps,
      lots: attrLots,
      selectedLots: ['G1', 'G2'],
    });
    const selectGeneral = tree.root.find(
      node => node.props.accessibilityLabel === 'Select all general lot lots',
    );
    expect(selectGeneral.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('parking section "Clear" is disabled when no section lot is selected', () => {
    const tree = render({
      ...defaultProps,
      lots: attrLots,
      selectedLots: ['E1'],
    });
    const clearGeneral = tree.root.find(
      node => node.props.accessibilityLabel === 'Clear general lot lot selection',
    );
    expect(clearGeneral.props.accessibilityState).toMatchObject({ disabled: true });
  });
});

// ────────────────────── matchesAttributes ──────────────────────

describe('matchesAttributes', () => {
  const evLot = attrLots[0];
  const emptyLot = attrLots[1];

  it('matches everything when no attributes active', () => {
    expect(matchesAttributes(emptyLot, [])).toBe(true);
  });

  it('returns true when all active attributes pass', () => {
    expect(matchesAttributes(evLot, ['ev', 'accessible'])).toBe(true);
  });

  it('returns false when any active attribute fails (AND semantics)', () => {
    expect(matchesAttributes(evLot, ['ev', 'motorcycle'])).toBe(false);
  });

  it('ignores unknown keys rather than rejecting', () => {
    expect(matchesAttributes(evLot, ['ev', 'made_up_key'])).toBe(true);
  });

  it('exposes a stable set of attribute keys', () => {
    expect(ATTRIBUTE_FILTERS.map(f => f.key)).toEqual([
      'ev',
      'low_emission',
      'accessible',
      'motorcycle',
      'daily_permit',
      'pay_station',
      'parkmobile',
      'covered',
    ]);
  });
});

// ────────────────────── Transit section toggles ──────────────────────

const mockRoutes = [
  { id: 'R1', name: 'Red Line', shortName: 'R', color: '#f00', status: 'active', coordinates: [] as [] },
  { id: 'R2', name: 'Blue Line', shortName: 'B', color: '#00f', status: 'active', coordinates: [] as [] },
];

describe('LotFilterModal -- transit section toggles', () => {
  it('"Show all routes" clears all hidden route ids', () => {
    const tree = render({
      ...defaultProps,
      routes: mockRoutes,
      hiddenRouteIds: ['R1', 'R2'],
    });
    const showAll = tree.root.find(
      node => node.props.accessibilityLabel === 'Show all routes',
    );
    ReactTestRenderer.act(() => showAll.props.onPress());

    const red = tree.root.find(
      node =>
        node.props.accessibilityRole === 'checkbox' &&
        node.props.accessibilityLabel === 'Hide Red Line route',
    );
    expect(red.props.accessibilityState).toMatchObject({ checked: true });
  });

  it('"Hide all routes" hides every route', () => {
    const tree = render({
      ...defaultProps,
      routes: mockRoutes,
      hiddenRouteIds: [],
    });
    const hideAll = tree.root.find(
      node => node.props.accessibilityLabel === 'Hide all routes',
    );
    ReactTestRenderer.act(() => hideAll.props.onPress());

    const red = tree.root.find(
      node =>
        node.props.accessibilityRole === 'checkbox' &&
        node.props.accessibilityLabel === 'Show Red Line route',
    );
    expect(red.props.accessibilityState).toMatchObject({ checked: false });
  });

  it('"Show all routes" is disabled when all routes already visible', () => {
    const tree = render({
      ...defaultProps,
      routes: mockRoutes,
      hiddenRouteIds: [],
    });
    const showAll = tree.root.find(
      node => node.props.accessibilityLabel === 'Show all routes',
    );
    expect(showAll.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('"Hide all routes" is disabled when every route already hidden', () => {
    const tree = render({
      ...defaultProps,
      routes: mockRoutes,
      hiddenRouteIds: ['R1', 'R2'],
    });
    const hideAll = tree.root.find(
      node => node.props.accessibilityLabel === 'Hide all routes',
    );
    expect(hideAll.props.accessibilityState).toMatchObject({ disabled: true });
  });

  it('omits section toggles when no routes are available', () => {
    const tree = render({ ...defaultProps, routes: [], hiddenRouteIds: [] });
    expect(
      tree.root.findAll(node => node.props.accessibilityLabel === 'Show all routes'),
    ).toHaveLength(0);
    expect(
      tree.root.findAll(node => node.props.accessibilityLabel === 'Hide all routes'),
    ).toHaveLength(0);
  });
});
