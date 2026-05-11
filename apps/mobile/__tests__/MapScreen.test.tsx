/**
 * MapScreen Component Tests
 *
 * Tests the main map screen:
 *   - Rendering with parking lot circles
 *   - Live occupancy data merge with mock position data
 *   - Filter button and modal
 *   - Navigate FAB opening the RecommendationModal
 *   - Lot press navigation
 *   - Stop marker interaction and StopModal
 */
/* eslint-disable @typescript-eslint/no-explicit-any */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

// ────────────────────── Mocks ──────────────────────

const mockNavigate = jest.fn();
jest.mock('@react-navigation/native', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const ReactImpl: typeof React = require('react');
  return {
    useNavigation: () => ({
      navigate: mockNavigate,
      goBack: jest.fn(),
      dispatch: jest.fn(),
    }),
    useRoute: () => ({ params: {} }),
    useIsFocused: () => true,
    // Treat focus effects as plain effects in tests — the screen is
    // always "focused" under the test renderer.
    useFocusEffect: (cb: () => void | (() => void)) => ReactImpl.useEffect(cb, []),
    NavigationContainer: ({ children }: { children: React.ReactNode }) => children,
  };
});

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

jest.mock('../src/hooks/useTransitData', () => ({
  useTransitData: () => ({
    routes: [{ id: 'r1', color: '#ff0000', coordinates: [{ latitude: 33.78, longitude: -118.11 }] }],
    stops: [{ id: 's1', name: 'Student Union', latitude: 33.78, longitude: -118.11, routeIds: ['r1'], color: '#ff0000' }],
    shuttles: [{ id: 'sh1', routeId: 'r1', latitude: 33.78, longitude: -118.11, heading: 90 }],
  }),
}));

jest.mock('../src/hooks/useStopETAs', () => ({
  useStopETAs: () => ({
    arrivals: [],
    isLoading: false,
  }),
}));

jest.mock('react-native-device-info', () => ({
  getBrand: jest.fn().mockResolvedValue('Apple'),
  getModel: jest.fn().mockResolvedValue('iPhone'),
  getSystemVersion: jest.fn().mockResolvedValue('17.0'),
  getVersion: jest.fn().mockResolvedValue('1.0.0'),
}));

// Mock react-native-maps
jest.mock('react-native-maps', () => {
  // eslint-disable-next-line @typescript-eslint/no-require-imports
  const { View } = require('react-native');
  const MockMapView = (props: any) => <View testID="map-view" {...props}>{props.children}</View>;
  const MockMarker = (props: any) => <View testID="marker" {...props}>{props.children}</View>;
  MockMarker.Animated = (props: any) => <View testID="animated-marker" {...props}>{props.children}</View>;
  const MockPolyline = (props: any) => <View testID="polyline" {...props} />;
  const MockPolygon = (props: any) => <View testID="polygon" {...props} />;
  class AnimatedRegion {
    constructor(coords: Record<string, unknown>) { Object.assign(this, coords); }
    timing() { return { start: jest.fn() }; }
  }

  return {
    __esModule: true,
    default: MockMapView,
    Marker: MockMarker,
    Polyline: MockPolyline,
    Polygon: MockPolygon,
    AnimatedRegion,
    PROVIDER_DEFAULT: 'default',
  };
});

jest.mock('../src/components', () => ({
  Header: ({ title }: { title?: string }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { Text, Image } = require('react-native');
    if (title) return <Text>{title}</Text>;
    return <Image testID="header-logo" />;
  },
}));

jest.mock('../src/components/Modals/FilterModal', () => ({
  LotFilterModal: () => null,
}));

jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => ({
    user: { userId: 'test@student.csulb.edu', displayName: 'Test User' },
    isAuthenticated: true,
    isLoading: false,
    login: jest.fn(),
    logout: jest.fn(),
    refreshSession: jest.fn(),
  }),
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

jest.mock('../src/components/Modals/StopModal', () => ({
  StopModal: (props: { isOpen: boolean }) => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { View, Text } = require('react-native');
    return props.isOpen ? (
      <View testID="stop-modal">
        <Text>StopModal Open</Text>
      </View>
    ) : null;
  },
}));

jest.mock('../src/components/Map/ShuttleMarker', () => ({
  ShuttleMarker: () => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { View } = require('react-native');
    return <View testID="shuttle-marker" />;
  }
}));

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
  const renderMapScreen = async (): Promise<ReactTestRenderer.ReactTestRenderer> => {
    let tree!: ReactTestRenderer.ReactTestRenderer;
    await ReactTestRenderer.act(async () => {
      tree = ReactTestRenderer.create(<MapScreen />);
      await Promise.resolve();
    });
    return tree;
  };

  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLotsList.mockReturnValue({ lots: mockApiLots, loading: false, error: null, refreshLots: jest.fn() });
  });

  describe('rendering', () => {
    it('renders without crashing', async () => {
      const tree = await renderMapScreen();
      expect(tree.toJSON()).toBeTruthy();
    });

    it('renders the header with logo', async () => {
      const tree = await renderMapScreen();
      const json = JSON.stringify(tree.toJSON());
      expect(json).toContain('header-logo');
    });

    it('renders parking lot markers correctly', async () => {
      const tree = await renderMapScreen();
      const json = JSON.stringify(tree.toJSON());
      expect(json).toContain('Lot G1');
      expect(json).toContain('Lot G2');
    });
  });

  describe('transit mapping', () => {
    it('renders transit routes, stops, and shuttles', async () => {
      const tree = await renderMapScreen();
      
      const json = JSON.stringify(tree.toJSON());
      expect(json).toContain('polyline'); // Route paths
      expect(json).toContain('Shuttle stop: Student Union'); // Stop accessibility label
      expect(json).toContain('shuttle-marker'); // Shuttle custom component
    });
  });

  describe('interactions', () => {
    it('opens StopModal when a shuttle stop marker is pressed', async () => {
      const tree = await renderMapScreen();

      // Verify modal is closed initially
      let json = JSON.stringify(tree.toJSON());
      expect(json).not.toContain('StopModal Open');

      // Find the stop marker
      const stopMarkers = tree.root.findAllByProps({ accessibilityLabel: 'Shuttle stop: Student Union' });

      // Press the first element in the matched array
      let touchable = stopMarkers[0];
      while (touchable && !touchable.props.onPress) {
        touchable = touchable.parent as any;
      }

      await ReactTestRenderer.act(async () => {
        touchable!.props.onPress();
      });

      // Verify modal is now open
      json = JSON.stringify(tree.toJSON());
      expect(json).toContain('StopModal Open');
    });

    it('navigates to Short Term Forecast when a lot is pressed', async () => {
      const tree = await renderMapScreen();

      // Find the Marker that wraps "Lot G1" text
      const g1TextNodes = tree.root.findAllByProps({ children: 'Lot G1' });
      let touchable = g1TextNodes[0].parent;
      
      // Traverse up to find the Marker onPress prop
      while (touchable && !touchable.props.onPress) {
        touchable = touchable.parent;
      }

      await ReactTestRenderer.act(async () => {
        touchable!.props.onPress();
      });

      expect(mockNavigate).toHaveBeenCalledWith('Short Term Forecast', {
        lotId: 'G1',
        lotName: 'Lot G1',
      });
    });
  });

  describe('buttons and modals', () => {
    it('renders the filter button', async () => {
      const tree = await renderMapScreen();

      const filterIcons = tree.root.findAllByProps({ name: 'filter' });
      expect(filterIcons.length).toBeGreaterThan(0);
    });

    it('renders the favorites button and opens RecommendationModal', async () => {
      const tree = await renderMapScreen();

      let json = JSON.stringify(tree.toJSON());
      expect(json).not.toContain('RecommendationModal Open');

      const navIcons = tree.root.findAllByProps({ name: 'star' });
      let touchable = navIcons[0].parent;
      while (touchable && !touchable.props.onPress) {
        touchable = touchable.parent;
      }

      await ReactTestRenderer.act(async () => {
        touchable!.props.onPress();
      });

      json = JSON.stringify(tree.toJSON());
      expect(json).toContain('RecommendationModal Open');
      expect(mockRefreshFavorites).toHaveBeenCalled();
    });
  });
});