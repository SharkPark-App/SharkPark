import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Alert } from 'react-native';

const mockGoBack = jest.fn();

jest.mock('react-native-vector-icons/Ionicons', () => 'Icon');

jest.mock('@react-navigation/native', () => ({
  useNavigation: () => ({
    goBack: mockGoBack,
    getParent: () => ({ navigate: jest.fn() }),
    navigate: jest.fn(),
  }),
  useRoute: () => ({ params: { lotId: 'G1' } }),
}));

jest.mock('react-native-safe-area-context', () => ({
  useSafeAreaInsets: () => ({ top: 0, bottom: 10, left: 0, right: 0 }),
}));

const authState = {
  isAuthenticated: true,
  isGuest: false,
};

jest.mock('../src/context/AuthContext', () => ({
  useAuth: () => authState,
}));

jest.mock('../src/context/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      lightGray: '#f3f4f6',
      white: '#ffffff',
      textPrimary: '#111827',
      darkGray: '#6b7280',
      primary: '#1d4ed8',
      secondary: '#f59e0b',
      gray: '#9ca3af',
      black: '#000000',
      error: '#dc2626',
      backgroundLight: '#ffffff',
      shadowDark: '#000000',
    },
    isDark: false,
  }),
}));

jest.mock('../src/hooks/useLotData', () => ({
  useLotData: () => ({
    lot: {
      id: 'lot-cuid-1',
      lot_id: 'G1',
      lot_name: 'Lot G1',
      occupancy_rate: 0.5,
      center_lat: 33.78,
      center_lng: -118.11,
    },
    forecast: [],
    loading: false,
    forecastLoading: false,
    refreshing: false,
    lastUpdatedAt: Date.now(),
    error: null,
    refreshLot: jest.fn(),
    bgLocationRequired: false,
    clearBgLocationRequired: jest.fn(),
  }),
}));

jest.mock('../src/services/api/contributor', () => ({
  useContributorState: () => 'granted',
}));

jest.mock('../src/hooks/useReliability', () => ({
  useReliability: () => ({ reliability: null, loading: false }),
}));

jest.mock('../src/hooks/useEvents', () => ({
  useEvents: () => ({ events: [] }),
}));

jest.mock('../src/hooks/useFavorites', () => ({
  __esModule: true,
  default: () => ({
    addFavorite: jest.fn(),
    removeFavorite: jest.fn(),
    favoriteLots: [],
  }),
}));

jest.mock('../src/hooks/useNearbyStopETAs', () => ({
  useNearbyStopETAs: () => [],
}));

jest.mock('../src/services/api/reports', () => ({
  reportsApi: { create: jest.fn() },
  ReportUnauthorizedError: class ReportUnauthorizedError extends Error {},
  ReportThrottledError: class ReportThrottledError extends Error {},
}));

jest.mock('../src/components', () => ({
  Header: ({ rightAction }: { rightAction?: React.ReactNode }) => rightAction ?? null,
  ReliabilityRow: () => null,
  LockedOccupancyBadge: () => null,
  LockedForecastCard: () => null,
  UnlockCTAButton: () => null,
}));

jest.mock('../src/components/HourlyChart', () => ({
  HourlyChart: () => null,
}));

jest.mock('../src/components/LotAmenities', () => ({
  LotAmenities: () => null,
}));

jest.mock('../src/components/VisitorPricingCard', () => ({
  VisitorPricingCard: () => null,
}));

jest.mock('../src/components/EventBanner', () => ({
  EventBanner: () => null,
}));

jest.mock('../src/components/NearbyTransitCard', () => ({
  NearbyTransitCard: () => null,
}));

jest.mock('../src/components/Modals/MapSelectModal', () => ({
  MapSelectModal: () => null,
}));

jest.mock('../src/components/Modals/ReliabilityModal', () => ({
  ReliabilityModal: () => null,
}));

jest.mock('../src/components/Modals/ReportModal', () => ({
  ReportModal: ({ isOpen }: { isOpen: boolean }) => (isOpen ? <></> : null),
}));

import { ShortTermForecastScreen } from '../src/screens/ShortTermForecastScreen';

describe('ShortTermForecastScreen report FAB auth gating', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    authState.isAuthenticated = true;
    authState.isGuest = false;
  });

  it('shows sign-in alert and keeps report modal closed for guests', () => {
    authState.isAuthenticated = false;
    authState.isGuest = true;
    const alertSpy = jest.spyOn(Alert, 'alert').mockImplementation(jest.fn());

    let tree: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(<ShortTermForecastScreen />);
    });
    const reportFab = tree!.root.findByProps({ accessibilityLabel: 'Report an incident' });

    ReactTestRenderer.act(() => {
      reportFab.props.onPress();
    });

    expect(alertSpy).toHaveBeenCalledWith(
      'Sign in required',
      'Please sign in to submit a report.',
    );

    const openReportModals = tree!.root.findAll(
      (node) => node.props?.isOpen === true,
    );
    expect(openReportModals).toHaveLength(0);

    alertSpy.mockRestore();
  });

  it('opens report modal for authenticated users', () => {
    let tree: ReactTestRenderer.ReactTestRenderer;
    ReactTestRenderer.act(() => {
      tree = ReactTestRenderer.create(<ShortTermForecastScreen />);
    });
    const reportFab = tree!.root.findByProps({ accessibilityLabel: 'Report an incident' });

    ReactTestRenderer.act(() => {
      reportFab.props.onPress();
    });

    const openReportModals = tree!.root.findAll(
      (node) => node.props?.isOpen === true,
    );
    expect(openReportModals.length).toBeGreaterThan(0);
  });
});
