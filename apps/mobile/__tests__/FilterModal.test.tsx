import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { LotFilterModal } from '../src/components/Modals/FilterModal';
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
  lots: mockLots,
  selectedLots: [] as string[],
  onApplyFilter: jest.fn(),
  routes: [] as { id: string; name: string; shortName: string; color: string; status: string; coordinates: [] }[],
  hiddenRouteIds: [] as string[],
  onApplyTransitFilter: jest.fn(),
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

  it('shows "Clear All" when lots are selected', () => {
    const tree = render({ ...defaultProps, selectedLots: ['G1'] });
    const btn = tree.root.find(
      node => node.props.accessibilityLabel === 'Clear All',
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
