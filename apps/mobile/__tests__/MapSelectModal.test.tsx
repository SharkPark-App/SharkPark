/**
 * MapSelectModal Component Tests
 *
 * Tests the map application selection modal:
 * - Rendering and visibility state
 * - Fetching available map apps via react-native-map-link
 * - Selecting an app and triggering respective open() method
 * - Close interactions / animations
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Linking } from 'react-native';
import { MapSelectModal } from '../src/components/Modals/MapSelectModal';
import { getApps } from 'react-native-map-link';

// ────────────────────── Mocks ──────────────────────

jest.mock('react-native-map-link', () => ({
  getApps: jest.fn(),
}));

jest.mock('react-native-vector-icons/Ionicons', () => 'Icon');

jest.mock('../src/context/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      white: '#ffffff',
      textPrimary: '#111827',
      borderGray: '#e5e7eb',
      lightGray: '#f3f4f6',
      primary: '#EBA91B',
      toggleGray: '#d1d5db',
    },
  }),
}));

// ────────────────────── Helpers ──────────────────────

/** Walk up from a node to find the nearest ancestor with onPress */
const findPressableAncestor = (node: ReactTestRenderer.ReactTestInstance) => {
  let current: ReactTestRenderer.ReactTestInstance | null = node;
  while (current) {
    if (typeof current.props?.onPress === 'function') return current;
    current = current.parent;
  }
  return null;
};

const mockAppOpen1 = jest.fn();
const mockAppOpen2 = jest.fn();

const mockApps = [
  { id: 'apple-maps', name: 'Apple Maps', icon: 1, open: mockAppOpen1 },
  { id: 'google-maps', name: 'Google Maps', icon: 2, open: mockAppOpen2 },
];

const defaultProps = {
  isVisible: true,
  onClose: jest.fn(),
  lat: 33.7817,
  lon: -118.1193,
  title: 'Lot G1',
};

// ────────────────────── Tests ──────────────────────

describe('MapSelectModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    jest.useFakeTimers();
    (getApps as jest.Mock).mockResolvedValue(mockApps);
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  // ─── Rendering ───

  describe('rendering', () => {
    it('renders correctly when visible', async () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(<MapSelectModal {...defaultProps} />);
      });
      
      const json = JSON.stringify(tree!.toJSON());
      expect(json).toContain('Navigate to ');
      expect(json).toContain('Lot G1');
      expect(tree!.toJSON()).toBeTruthy();
    });

    it('renders null/empty when closed', async () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(
          <MapSelectModal {...defaultProps} isVisible={false} />
        );
      });
      
      // React Native Modal with visible=false renders null
      expect(tree!.toJSON()).toBeNull();
    });
  });

  // ─── Fetching Apps ───

  describe('fetching apps', () => {
    it('calls getApps with correct coordinates and props', async () => {
      await ReactTestRenderer.act(async () => {
        ReactTestRenderer.create(<MapSelectModal {...defaultProps} />);
      });

      expect(getApps).toHaveBeenCalledTimes(1);
      expect(getApps).toHaveBeenCalledWith(expect.objectContaining({
        latitude: 33.7817,
        longitude: -118.1193,
        title: 'Lot G1',
        googleForceLatLon: true,
        directionsMode: 'car',
      }));
    });

    it('displays the list of fetched map apps', async () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(<MapSelectModal {...defaultProps} />);
      });

      const json = JSON.stringify(tree!.toJSON());
      expect(json).toContain('Apple Maps');
      expect(json).toContain('Google Maps');
    });

    it('handles getApps rejection gracefully', async () => {
      const consoleSpy = jest.spyOn(console, 'error').mockImplementation(() => {});
      (getApps as jest.Mock).mockRejectedValueOnce(new Error('Fetch failed'));

      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(<MapSelectModal {...defaultProps} />);
      });

      expect(consoleSpy).toHaveBeenCalledWith('Failed to fetch map apps:', expect.any(Error));
      
      const json = JSON.stringify(tree!.toJSON());
      expect(json).toContain('Navigate to ');
      expect(json).toContain('Lot G1');
      expect(json).not.toContain('Apple Maps');
      
      consoleSpy.mockRestore();
    });
  });

  // ─── Interactions ───

  describe('interactions', () => {
    it('calls open() on the selected app and triggers close animation', async () => {
      const openURLSpy = jest.spyOn(Linking, 'openURL').mockResolvedValue(undefined);

      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(<MapSelectModal {...defaultProps} />);
      });

      // Find the Apple Maps text and tap its parent row
      const appleMapsText = tree!.root.findByProps({ children: 'Apple Maps' });
      const touchable = findPressableAncestor(appleMapsText);

      await ReactTestRenderer.act(async () => {
        await touchable!.props.onPress();
      });

      // Apple Maps open() is overridden to use Linking.openURL with coordinate-anchored URL
      expect(openURLSpy).toHaveBeenCalledTimes(1);
      expect(openURLSpy).toHaveBeenCalledWith(
        `maps://?ll=${defaultProps.lat},${defaultProps.lon}&q=${encodeURIComponent(defaultProps.title)}&dirflg=d`
      );
      expect(mockAppOpen2).not.toHaveBeenCalled();

      // Animation completion
      ReactTestRenderer.act(() => {
        jest.advanceTimersByTime(250);
      });

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
      openURLSpy.mockRestore();
    });

    it('calls onClose when the close icon is pressed', async () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(<MapSelectModal {...defaultProps} />);
      });

      // Find the close icon
      const closeIcon = tree!.root.findByProps({ name: 'close' });
      const touchable = findPressableAncestor(closeIcon);

      await ReactTestRenderer.act(async () => {
        touchable!.props.onPress();
      });

      // Animation completion
      ReactTestRenderer.act(() => {
        jest.advanceTimersByTime(250);
      });

      expect(defaultProps.onClose).toHaveBeenCalledTimes(1);
    });
  });
});