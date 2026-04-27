import { Animated } from 'react-native';
import ReactTestRenderer from 'react-test-renderer';
import { ReliabilityModal } from '../src/components/Modals/ReliabilityModal';
import { collectTexts, hasText, createRenderer } from './testUtils';

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

jest.mock('../src/components/ReliabilityMeter', () => ({
  ReliabilityBar: () => null,
}));

jest.mock('../src/types/reliability', () => ({
  CONFIDENCE_COLORS: { HIGH: '#10b981', MEDIUM: '#f59e0b', LOW: '#ef4444' },
  CONFIDENCE_LABELS: { HIGH: 'High confidence', MEDIUM: 'Medium confidence', LOW: 'Low confidence' },
}));

// ────────────────────── Helpers ──────────────────────

const mockFactor = { name: '', rawValue: 0, normalizedValue: 0, weight: 0, weightedScore: 0 };

const mockReliability = {
  confidence: 'HIGH' as const,
  score: 0.85,
  isColdStart: false,
  explanation: 'High confidence based on recent data',
  computedAt: new Date().toISOString(),
  lotId: 'G6',
  factors: {
    penetrationRate: { ...mockFactor, normalizedValue: 0.8, weight: 0.3 },
    dataFreshness: { ...mockFactor, normalizedValue: 0.9, weight: 0.25 },
    eventFrequency: mockFactor,
    sampleSize: mockFactor,
    historicalAccuracy: mockFactor,
  },
};

const render = createRenderer(ReliabilityModal);

// ────────────────────── Tests ──────────────────────

describe('ReliabilityModal -- rendering', () => {
  it('renders without crashing when open', () => {
    const tree = render({ isOpen: true, onClose: jest.fn(), reliability: mockReliability });
    expect(tree.toJSON()).toBeTruthy();
  });

  it('renders the modal title', () => {
    const tree = render({ isOpen: true, onClose: jest.fn(), reliability: mockReliability });
    expect(hasText(collectTexts(tree.root), 'Data Reliability')).toBe(true);
  });

  it('renders factor names', () => {
    const tree = render({ isOpen: true, onClose: jest.fn(), reliability: mockReliability });
    const texts = collectTexts(tree.root);
    expect(hasText(texts, 'App Usage')).toBe(true);
    expect(hasText(texts, 'Data Freshness')).toBe(true);
  });

  it('renders explanation text', () => {
    const tree = render({ isOpen: true, onClose: jest.fn(), reliability: mockReliability });
    expect(hasText(collectTexts(tree.root), 'High confidence based on recent data')).toBe(true);
  });

  it('renders nothing meaningful when reliability is null', () => {
    const tree = render({ isOpen: true, onClose: jest.fn(), reliability: null });
    expect(hasText(collectTexts(tree.root), 'Data Reliability')).toBe(true);
    expect(hasText(collectTexts(tree.root), 'App Usage')).toBe(false);
  });
});

describe('ReliabilityModal -- close button accessibility', () => {
  it('close button has accessibilityRole="button" and accessibilityLabel="Close"', () => {
    const tree = render({ isOpen: true, onClose: jest.fn(), reliability: mockReliability });
    const closeBtn = tree.root.find(
      node =>
        node.props.accessibilityRole === 'button' &&
        node.props.accessibilityLabel === 'Close',
    );
    expect(closeBtn).toBeTruthy();
  });

  it('calls onClose when close button is pressed', () => {
    // stub out animation so callback fires right away
    jest.spyOn(Animated, 'timing').mockReturnValue({
      start: (cb?: () => void) => cb?.(),
    } as ReturnType<typeof Animated.timing>);

    const onClose = jest.fn();
    const tree = render({ isOpen: true, onClose, reliability: mockReliability });
    const closeBtn = tree.root.find(
      node =>
        node.props.accessibilityRole === 'button' &&
        node.props.accessibilityLabel === 'Close',
    );
    ReactTestRenderer.act(() => {
      closeBtn.props.onPress();
    });
    expect(onClose).toHaveBeenCalled();
    jest.restoreAllMocks();
  });
});

describe('ReliabilityModal -- factor row accessibility', () => {
  it('factor rows have accessibilityLabel with factor name and percentage', () => {
    const tree = render({ isOpen: true, onClose: jest.fn(), reliability: mockReliability });
    const factorRows = tree.root.findAll(
      node =>
        node.props.accessible === true &&
        typeof node.props.accessibilityLabel === 'string' &&
        node.props.accessibilityLabel.includes('%'),
    );
    expect(factorRows.length).toBeGreaterThan(0);
    factorRows.forEach(row => {
      expect(row.props.accessibilityLabel).toMatch(/\d+%/);
    });
  });
});

describe('ReliabilityModal -- cold start warning', () => {
  it('shows cold start warning when isColdStart is true', () => {
    const tree = render({
      isOpen: true,
      onClose: jest.fn(),
      reliability: { ...mockReliability, isColdStart: true },
    });
    expect(hasText(collectTexts(tree.root), 'Limited data available')).toBe(true);
  });

  it('hides cold start warning when isColdStart is false', () => {
    const tree = render({ isOpen: true, onClose: jest.fn(), reliability: mockReliability });
    expect(hasText(collectTexts(tree.root), 'Limited data available')).toBe(false);
  });
});
