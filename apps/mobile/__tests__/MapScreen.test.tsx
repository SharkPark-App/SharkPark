/**
 * MapScreen Component Tests
 *
 * Tests the main map screen:
 *   - Rendering with parking lot circles
 *   - Live occupancy data merge with mock position data
 *   - Filter button and modal
 *   - Navigate FAB opening the RecommendationModal
 *   - Lot press navigation
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

// ────────────────────── Mocks ──────────────────────

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    navigate: mockNavigate,
    goBack: jest.fn(),
    dispatch: jest.fn(),
  }),
  useRoute: () => ({ params: {} }),
  useIsFocused: () => true,
  NavigationContainer: ({ children }: { children: React.ReactNode }) => children,
}));

jest.mock('../src/context/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      primary: '#1a73e8',
      secondary: '#f59e0b',
      white: '#ffffff',
      black: '#000000',
      backgroundLight: '#f5f5f5',
      shadowDark: '#000000',
      textPrimary: '#333333',
    },
    isDark: false,
  }),
  ThemeColors: {},
}));

const mockRefreshFavorites = jest.fn();
jest.mock('../src/hooks/useFavorites', () => ({
  __esModule: true,
  default: () => ({
    favoriteLots: ['G1', 'G2'],
    isLoading: false,
    error: null,
    addFavorite: jest.fn(),
    removeFavorite: jest.fn(),
    refreshFavorites: mockRefreshFavorites,
  }),
  useFavorites: () => ({
    favoriteLots: ['G1', 'G2'],
    isLoading: false,
    error: null,
    addFavorite: jest.fn(),
    removeFavorite: jest.fn(),
    refreshFavorites: mockRefreshFavorites,
  }),
}));

const mockUseLotsList = jest.fn();
jest.mock('../src/hooks/useLotData', () => ({
  useLotsList: () => mockUseLotsList(),
}));

jest.mock('../src/components', () => ({
  Header: ({ title, logo }: { title?: string; logo?: unknown }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text, Image } = require('react-native');
    if (logo) return <Image testID="header-logo" source={logo} />;
    return <Text>{title}</Text>;
  },
}));

jest.mock('../src/components/Modals/FilterModal', () => ({
  LotFilterModal: () => null,
}));

jest.mock('../src/components/Modals/RecommendationModal', () => ({
  RecommendationModal: (props: { isOpen: boolean; favoriteLotIds: string[]; onClose: () => void; onSelectLot: (id: string, name: string) => void }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { View, Text } = require('react-native');
    return props.isOpen ? (
      <View testID="recommendation-modal">
        <Text>RecommendationModal Open</Text>
      </View>
    ) : null;
  },
}));

// Mock react-native-reanimated Animated.View as RN View
jest.mock('react-native-reanimated', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native');
  return {
    __esModule: true,
    default: {
      View: RN.View,
      Text: RN.Text,
      Image: RN.Image,
      ScrollView: RN.ScrollView,
      createAnimatedComponent: (component: unknown) => component,
    },
    useSharedValue: (value: number) => ({ value }),
    useAnimatedStyle: (cb: () => Record<string, unknown>) => cb(),
    withTiming: (value: number) => value,
    withSpring: (value: number) => value,
  };
});

// Mock react-native-gesture-handler
jest.mock('react-native-gesture-handler', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const RN = require('react-native');
  return {
    GestureDetector: ({ children }: { children: React.ReactNode }) => children,
    Gesture: {
      Pan: () => ({
        onStart: jest.fn().mockReturnThis(),
        onUpdate: jest.fn().mockReturnThis(),
        onEnd: jest.fn().mockReturnThis(),
      }),
      Pinch: () => ({
        onStart: jest.fn().mockReturnThis(),
        onUpdate: jest.fn().mockReturnThis(),
        onEnd: jest.fn().mockReturnThis(),
      }),
      Simultaneous: jest.fn(() => ({})),
    },
    GestureHandlerRootView: RN.View,
  };
});

// Must import after all mocks
import MapScreen from '../src/screens/MapScreen';

// ────────────────────── Helpers ──────────────────────

const mockApiLots = [
  {
    lot_id: 'G1',
    lot_name: 'Lot G1',
    capacity: 200,
    current_occupancy: 90,
    occupancy_rate: 0.45,
    available: 110,
    fill_status: 'AVAILABLE',
    estimated_occupancy: 90,
    estimated_available: 110,
    raw_occupancy: 90,
    effective_penetration_rate: 1,
  },
  {
    lot_id: 'G2',
    lot_name: 'Lot G2',
    capacity: 300,
    current_occupancy: 210,
    occupancy_rate: 0.70,
    available: 90,
    fill_status: 'FILLING',
    estimated_occupancy: 210,
    estimated_available: 90,
    raw_occupancy: 210,
    effective_penetration_rate: 1,
  },
];

// ────────────────────── Tests ──────────────────────

describe('MapScreen', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLotsList.mockReturnValue({ lots: [], loading: false, error: null, refreshLots: jest.fn() });
  });

  describe('rendering', () => {
    it('renders without crashing', () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(<MapScreen />);
      });
      expect(tree!.toJSON()).toBeTruthy();
    });

    it('renders the header with logo', () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(<MapScreen />);
      });
      const json = JSON.stringify(tree!.toJSON());
      expect(json).toContain('header-logo');
    });

    it('renders parking lot circles from mock data when API has no data', () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(<MapScreen />);
      });
      const json = JSON.stringify(tree!.toJSON());
      // Mock data has lots G1 through E11
      expect(json).toContain('G1');
      expect(json).toContain('E1');
    });
  });

  describe('live data merge', () => {
    it('uses API occupancy data when available', () => {
      mockUseLotsList.mockReturnValue({
        lots: mockApiLots,
        loading: false,
        error: null,
        refreshLots: jest.fn(),
      });

      let tree: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(<MapScreen />);
      });

      // The component should still render all lot circles
      const json = JSON.stringify(tree!.toJSON());
      expect(json).toContain('G1');
      expect(json).toContain('G2');
    });

    it('falls back to mock data for lots not in API response', () => {
      mockUseLotsList.mockReturnValue({
        lots: [mockApiLots[0]], // Only G1 from API
        loading: false,
        error: null,
        refreshLots: jest.fn(),
      });

      let tree: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(<MapScreen />);
      });

      // Should still render G2 from mock data
      const json = JSON.stringify(tree!.toJSON());
      expect(json).toContain('G2');
    });
  });

  describe('filter button', () => {
    it('renders the filter button', () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(<MapScreen />);
      });

      // Filter button renders an Icon with name="filter"
      const filterIcons = tree!.root.findAllByProps({ name: 'filter' });
      expect(filterIcons.length).toBeGreaterThan(0);
    });
  });

  describe('navigate FAB', () => {
    it('renders the navigate button', () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(<MapScreen />);
      });

      const navIcons = tree!.root.findAllByProps({ name: 'navigate' });
      expect(navIcons.length).toBeGreaterThan(0);
    });

    it('opens RecommendationModal when navigate button is pressed', async () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(<MapScreen />);
      });

      // Modal should NOT be open initially
      let json = JSON.stringify(tree!.toJSON());
      expect(json).not.toContain('RecommendationModal Open');

      // Find the navigate icon's parent TouchableOpacity and press it
      const navIcon = tree!.root.findAllByProps({ name: 'navigate' })[0];
      let touchable = navIcon.parent;
      while (touchable && !touchable.props.onPress) {
        touchable = touchable.parent;
      }
      expect(touchable).toBeTruthy();

      await ReactTestRenderer.act(async () => {
        touchable!.props.onPress();
      });

      // Modal should now be open
      json = JSON.stringify(tree!.toJSON());
      expect(json).toContain('RecommendationModal Open');
    });

    it('calls refreshFavorites when opening recommendation modal', async () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(<MapScreen />);
      });

      const navIcon = tree!.root.findAllByProps({ name: 'navigate' })[0];
      let touchable = navIcon.parent;
      while (touchable && !touchable.props.onPress) {
        touchable = touchable.parent;
      }

      await ReactTestRenderer.act(async () => {
        touchable!.props.onPress();
      });

      expect(mockRefreshFavorites).toHaveBeenCalled();
    });
  });

  describe('lot interaction', () => {
    it('renders lot circles that are pressable', () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(<MapScreen />);
      });

      // Find a lot text (e.g., "G1") and verify its parent chain has an onPress
      const g1Texts = tree!.root.findAllByProps({ children: 'G1' });
      expect(g1Texts.length).toBeGreaterThan(0);

      let touchable = g1Texts[0].parent;
      while (touchable && !touchable.props.onPress) {
        touchable = touchable.parent;
      }
      expect(touchable).toBeTruthy();
    });

    it('navigates to Short Term Forecast when a lot is pressed', async () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(<MapScreen />);
      });

      // Find lot "G1" and tap
      const g1Texts = tree!.root.findAllByProps({ children: 'G1' });
      let touchable = g1Texts[0].parent;
      while (touchable && !touchable.props.onPress) {
        touchable = touchable.parent;
      }

      await ReactTestRenderer.act(async () => {
        touchable!.props.onPress();
      });

      expect(mockNavigate).toHaveBeenCalledWith('Short Term Forecast', {
        lotId: 'G1',
        lotName: 'G1',
      });
    });
  });

  describe('filtering', () => {
    it('shows all lots when no filter is applied', () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(<MapScreen />);
      });
      const json = JSON.stringify(tree!.toJSON());
      // Should contain both general and employee lots
      expect(json).toContain('G1');
      expect(json).toContain('E1');
      expect(json).toContain('E5');
    });
  });
});
