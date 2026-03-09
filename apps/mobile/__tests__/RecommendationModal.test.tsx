/**
 * RecommendationModal Component Tests
 *
 * Tests the combined Favorites & Recommendations modal:
 *   - Rendering favorites, empty states, loading, alternatives
 *   - Navigating between steps (favorites → loading → alternatives → back)
 *   - Error handling when API fails
 *   - Close / select interactions
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { RecommendationModal } from '../src/components/Modals/RecommendationModal';
import type { ParkingLotResponse, LotRecommendation } from '../src/services/api/lots';

// ────────────────────── Mocks ──────────────────────

const mockGetRecommendedLots = jest.fn();

jest.mock('../src/services/api', () => ({
  lotsApi: { getRecommendedLots: (...args: unknown[]) => mockGetRecommendedLots(...args) },
}));

const mockUseLotsList = jest.fn();
jest.mock('../src/hooks/useLotData', () => ({
  useLotsList: () => mockUseLotsList(),
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

/** Minimal ParkingLotResponse fixture */
const makeLot = (overrides: Partial<ParkingLotResponse> = {}): ParkingLotResponse => ({
  lot_id: 'G1',
  lot_name: 'Lot G1',
  display_name: 'Lot G1',
  lot_number: 'G1',
  lot_type: 'STUDENT',
  capacity: 200,
  current_occupancy: 100,
  location_description: '',
  building_proximity: [],
  center_lat: 0,
  center_lng: 0,
  geofence_polygon: [],
  geofence_radius: 50,
  permit_types: ['STUDENT'],
  daily_permit_allowed: false,
  hours_weekday: '6am-10pm',
  hours_saturday: 'Closed',
  hours_sunday: 'Closed',
  ev_charging_stations: 0,
  motorcycle_spaces: 0,
  accessible_spaces: 0,
  has_lighting: true,
  has_cameras: true,
  has_emergency_phone: true,
  is_covered: false,
  is_paved: true,
  penetration_rate: 0.1,
  avg_turnover_minutes: 120,
  confidence: 'HIGH',
  timestamp: new Date().toISOString(),
  available: 100,
  occupancy_rate: 0.5,
  fill_status: 'AVAILABLE',
  ...overrides,
});

const makeRec = (overrides: Partial<LotRecommendation> = {}): LotRecommendation => ({
  ...makeLot({ lot_id: 'G2', lot_name: 'Lot G2' }),
  recommendation_score: 0.85,
  distance_meters: 200,
  reason: 'Plenty of space available · very close by',
  ...overrides,
});

const defaultProps = {
  isOpen: true,
  favoriteLotIds: ['G1'],
  onClose: jest.fn(),
  onSelectLot: jest.fn(),
};

const lotG1 = makeLot();
const lotG2 = makeLot({
  lot_id: 'G2',
  lot_name: 'Lot G2',
  display_name: 'Lot G2',
  capacity: 300,
  current_occupancy: 120,
  occupancy_rate: 0.4,
  available: 180,
});

// ────────────────────── Tests ──────────────────────

describe('RecommendationModal', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    mockUseLotsList.mockReturnValue({ lots: [lotG1, lotG2], loading: false });
  });

  // ─── Rendering ───

  describe('rendering', () => {
    it('renders without crashing when open', () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(<RecommendationModal {...defaultProps} />);
      });
      expect(tree!.toJSON()).toBeTruthy();
    });

    it('renders null when closed', () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(
          <RecommendationModal {...defaultProps} isOpen={false} />,
        );
      });
      // React Native Modal with visible=false renders null
      expect(tree!.toJSON()).toBeNull();
    });

    it('shows "My Lots" title on favorites step', () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(<RecommendationModal {...defaultProps} />);
      });
      const root = tree!.root;
      expect(root.findByProps({ children: 'My Lots' })).toBeTruthy();
    });
  });

  // ─── Favorites step ───

  describe('favorites step', () => {
    it('renders lots matching favoriteLotIds', () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(<RecommendationModal {...defaultProps} />);
      });
      const json = JSON.stringify(tree!.toJSON());
      expect(json).toContain('Lot G1');
      expect(json).toContain('50');
      // Text children are split: ["100", " / ", "200", " spots taken"]
      expect(json).toContain('spots taken');
    });

    it('shows multiple favorite lots', () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(
          <RecommendationModal {...defaultProps} favoriteLotIds={['G1', 'G2']} />,
        );
      });
      const json = JSON.stringify(tree!.toJSON());
      expect(json).toContain('Lot G1');
      expect(json).toContain('Lot G2');
    });

    it('shows empty state when no favorite lot IDs provided', () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(
          <RecommendationModal {...defaultProps} favoriteLotIds={[]} />,
        );
      });
      const json = JSON.stringify(tree!.toJSON());
      expect(json).toContain('No Favorite Lots');
    });

    it('shows loading spinner when lots are loading', () => {
      mockUseLotsList.mockReturnValue({ lots: [], loading: true });
      let tree: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(<RecommendationModal {...defaultProps} />);
      });
      // Should NOT show lot names or empty state
      const json = JSON.stringify(tree!.toJSON());
      expect(json).not.toContain('Lot G1');
      expect(json).not.toContain('No Favorite Lots');
    });

    it('shows empty state when favoriteLotIds do not match any lots', () => {
      let tree: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(
          <RecommendationModal {...defaultProps} favoriteLotIds={['NONEXISTENT']} />,
        );
      });
      const json = JSON.stringify(tree!.toJSON());
      expect(json).toContain('No Favorite Lots');
    });
  });

  // ─── Find Alternatives flow ───

  describe('find alternatives', () => {
    it('calls API and shows alternatives on success', async () => {
      const recommendations = [
        makeRec({ lot_id: 'G3', lot_name: 'Lot G3' }),
        makeRec({ lot_id: 'G4', lot_name: 'Lot G4', reason: 'Filling up slowly · nearby' }),
      ];
      mockGetRecommendedLots.mockResolvedValueOnce(recommendations);

      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(<RecommendationModal {...defaultProps} />);
      });

      // Tap the "Alts" button for G1
      const altsButtons = tree!.root.findAllByProps({ children: 'Alts' });
      expect(altsButtons.length).toBeGreaterThan(0);

      await ReactTestRenderer.act(async () => {
        const altsTouchable = findPressableAncestor(altsButtons[0]);
        altsTouchable!.props.onPress();
      });

      // Should have called API with lot ID
      expect(mockGetRecommendedLots).toHaveBeenCalledWith('G1');

      // Should now show "Recommended Lots" title and alternatives
      const json = JSON.stringify(tree!.toJSON());
      expect(json).toContain('Recommended Lots');
      expect(json).toContain('Lot G3');
      expect(json).toContain('Lot G4');
      expect(json).toContain('Filling up slowly');
    });

    it('shows error message when API fails', async () => {
      mockGetRecommendedLots.mockRejectedValueOnce(new Error('Network error'));

      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(<RecommendationModal {...defaultProps} />);
      });

      const altsButtons = tree!.root.findAllByProps({ children: 'Alts' });
      await ReactTestRenderer.act(async () => {
        findPressableAncestor(altsButtons[0])!.props.onPress();
      });

      const json = JSON.stringify(tree!.toJSON());
      expect(json).toContain('Something went wrong');
      expect(json).toContain('Could not load recommendations');
    });

    it('shows empty alternatives state when API returns empty array', async () => {
      mockGetRecommendedLots.mockResolvedValueOnce([]);

      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(<RecommendationModal {...defaultProps} />);
      });

      const altsButtons = tree!.root.findAllByProps({ children: 'Alts' });
      await ReactTestRenderer.act(async () => {
        findPressableAncestor(altsButtons[0])!.props.onPress();
      });

      const json = JSON.stringify(tree!.toJSON());
      expect(json).toContain('No Alternatives Found');
      expect(json).toContain('All similar lots are currently full');
    });

    it('shows source lot context in alternatives view', async () => {
      mockGetRecommendedLots.mockResolvedValueOnce([makeRec()]);

      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(<RecommendationModal {...defaultProps} />);
      });

      const altsButtons = tree!.root.findAllByProps({ children: 'Alts' });
      await ReactTestRenderer.act(async () => {
        findPressableAncestor(altsButtons[0])!.props.onPress();
      });

      const json = JSON.stringify(tree!.toJSON());
      // Source lot context: "Alternatives to Lot G1 (50% full)"
      // Text children split: ["Alternatives to ", "Lot G1", " (", 50, "% full)"]
      expect(json).toContain('Alternatives to');
      expect(json).toContain('Lot G1');
      expect(json).toContain('% full');
    });
  });

  // ─── Navigation: back button ───

  describe('back navigation', () => {
    it('returns to favorites when back button is pressed', async () => {
      mockGetRecommendedLots.mockResolvedValueOnce([makeRec()]);

      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(<RecommendationModal {...defaultProps} />);
      });

      // Go to alternatives
      const altsButtons = tree!.root.findAllByProps({ children: 'Alts' });
      await ReactTestRenderer.act(async () => {
        findPressableAncestor(altsButtons[0])!.props.onPress();
      });

      // Verify we're on alternatives step
      let json = JSON.stringify(tree!.toJSON());
      expect(json).toContain('Recommended Lots');

      // Tap the back button (Icon with name="arrow-back")
      const backButton = tree!.root.findAllByProps({ name: 'arrow-back' });
      expect(backButton.length).toBeGreaterThan(0);

      await ReactTestRenderer.act(async () => {
        findPressableAncestor(backButton[0])!.props.onPress();
      });

      // Wait for animation callback
      await ReactTestRenderer.act(async () => {
        await new Promise<void>(r => setTimeout(r, 250));
      });

      json = JSON.stringify(tree!.toJSON());
      expect(json).toContain('My Lots');
    });
  });

  // ─── Close behavior ───

  describe('close behavior', () => {
    it('calls onClose when close button is pressed', async () => {
      const onClose = jest.fn();
      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(
          <RecommendationModal {...defaultProps} onClose={onClose} />,
        );
      });

      const closeButton = tree!.root.findByProps({ children: '✕' });
      await ReactTestRenderer.act(async () => {
        findPressableAncestor(closeButton)!.props.onPress();
      });

      expect(onClose).toHaveBeenCalledTimes(1);
    });

    it('resets state when closed and reopened', async () => {
      mockGetRecommendedLots.mockResolvedValueOnce([makeRec()]);

      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(<RecommendationModal {...defaultProps} />);
      });

      // Navigate to alternatives
      const altsButtons = tree!.root.findAllByProps({ children: 'Alts' });
      await ReactTestRenderer.act(async () => {
        findPressableAncestor(altsButtons[0])!.props.onPress();
      });

      // Close modal
      const closeButton = tree!.root.findByProps({ children: '✕' });
      await ReactTestRenderer.act(async () => {
        findPressableAncestor(closeButton)!.props.onPress();
      });

      // Modal should reset to favorites step when re-opened
      // The handleClose sets step='favorites', so re-rendering with isOpen=true
      // should show "My Lots"
      await ReactTestRenderer.act(async () => {
        tree!.update(<RecommendationModal {...defaultProps} isOpen={true} />);
      });

      const json = JSON.stringify(tree!.toJSON());
      expect(json).toContain('My Lots');
      expect(json).not.toContain('Recommended Lots');
    });
  });

  // ─── Lot selection ───

  describe('lot selection', () => {
    it('calls onSelectLot and onClose when a favorite lot row is tapped', async () => {
      const onSelectLot = jest.fn();
      const onClose = jest.fn();

      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(
          <RecommendationModal
            {...defaultProps}
            onSelectLot={onSelectLot}
            onClose={onClose}
          />,
        );
      });

      // Find the lot name text, then walk up to the nearest pressable ancestor
      const lotNameTexts = tree!.root.findAllByProps({ children: 'Lot G1' });
      expect(lotNameTexts.length).toBeGreaterThan(0);

      const touchable = findPressableAncestor(lotNameTexts[0]);
      expect(touchable).toBeTruthy();

      await ReactTestRenderer.act(async () => {
        touchable!.props.onPress();
      });

      expect(onSelectLot).toHaveBeenCalledWith('G1', 'Lot G1');
      expect(onClose).toHaveBeenCalled();
    });

    it('calls onSelectLot when a recommendation is tapped', async () => {
      const onSelectLot = jest.fn();
      const onClose = jest.fn();
      mockGetRecommendedLots.mockResolvedValueOnce([
        makeRec({ lot_id: 'G3', lot_name: 'Lot G3' }),
      ]);

      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(
          <RecommendationModal
            {...defaultProps}
            onSelectLot={onSelectLot}
            onClose={onClose}
          />,
        );
      });

      // Navigate to alternatives
      const altsButtons = tree!.root.findAllByProps({ children: 'Alts' });
      await ReactTestRenderer.act(async () => {
        findPressableAncestor(altsButtons[0])!.props.onPress();
      });

      // Find the recommended lot name and tap it
      const recLotNames = tree!.root.findAllByProps({ children: 'Lot G3' });
      expect(recLotNames.length).toBeGreaterThan(0);

      const touchable = findPressableAncestor(recLotNames[0]);

      await ReactTestRenderer.act(async () => {
        touchable!.props.onPress();
      });

      expect(onSelectLot).toHaveBeenCalledWith('G3', 'Lot G3');
      expect(onClose).toHaveBeenCalled();
    });
  });

  // ─── Occupancy display ───

  describe('occupancy display', () => {
    it('displays correct percentage and badge for each favorite lot', () => {
      const highOccupancyLot = makeLot({
        lot_id: 'E1',
        lot_name: 'Lot E1',
        capacity: 100,
        current_occupancy: 80,
        occupancy_rate: 0.8,
        available: 20,
        fill_status: 'NEARLY_FULL',
      });
      mockUseLotsList.mockReturnValue({ lots: [lotG1, highOccupancyLot], loading: false });

      let tree: ReactTestRenderer.ReactTestRenderer;
      ReactTestRenderer.act(() => {
        tree = ReactTestRenderer.create(
          <RecommendationModal {...defaultProps} favoriteLotIds={['G1', 'E1']} />,
        );
      });
      const json = JSON.stringify(tree!.toJSON());
      // Percentage badges render as ["50", "%"] and ["80", "%"]
      expect(json).toContain('"50"');
      expect(json).toContain('"80"');
      expect(json).toContain('spots taken');
    });

    it('displays recommendation reason text', async () => {
      const recs = [
        makeRec({ reason: 'Plenty of space available · very close by' }),
      ];
      mockGetRecommendedLots.mockResolvedValueOnce(recs);

      let tree: ReactTestRenderer.ReactTestRenderer;
      await ReactTestRenderer.act(async () => {
        tree = ReactTestRenderer.create(<RecommendationModal {...defaultProps} />);
      });

      const altsButtons = tree!.root.findAllByProps({ children: 'Alts' });
      await ReactTestRenderer.act(async () => {
        findPressableAncestor(altsButtons[0])!.props.onPress();
      });

      const json = JSON.stringify(tree!.toJSON());
      expect(json).toContain('Plenty of space available');
      expect(json).toContain('very close by');
    });
  });
});
