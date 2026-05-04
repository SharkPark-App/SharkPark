/**
 * LotAmenities Component Tests
 *
 * Tests the lot detail amenities section:
 *   - Renders all five info cards (Lot Info, Permits, Hours, Spaces, Safety)
 *   - Conditional rendering (levels for structures, motorcycle when >0, building proximity)
 *   - EV charging display (none vs count)
 *   - Hours formatting (object vs "CLOSED" string)
 *   - Daily permit with/without rate
 *   - Safety chips (available vs unavailable styling)
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';

// ────────────────────── Mocks ──────────────────────

jest.mock('../src/context/ThemeContext', () => ({
  useTheme: () => ({
    colors: {
      primary: '#EBA91B',
      white: '#ffffff',
      black: '#1f2937',
      gray: '#6b7280',
      lightGray: '#f3f4f6',
      borderGray: '#e5e7eb',
      textPrimary: '#111827',
      shadowDark: '#000',
    },
    isDark: false,
  }),
}));

import { LotAmenities } from '../src/components/LotAmenities';
import type { ParkingLotResponse } from '../src/services/api/lots';
import { collectTexts } from './testUtils';

// ────────────────────── Helpers ──────────────────────

const makeLot = (overrides: Partial<ParkingLotResponse> = {}): ParkingLotResponse => ({
  id: 'cltest000000000001',
  lot_id: 'G1',
  lot_name: 'Lot G1',
  display_name: 'Lot G1',
  lot_number: 'G1',
  lot_type: 'STUDENT',
  capacity: 500,
  current_occupancy: 250,
  location_description: 'East Campus near ECS Building',
  buildings: ['ECS', 'Library'],
  center_lat: 33.78,
  center_lng: -118.11,
  geofence_polygon: [],
  geofence_radius: 50,
  permit_types: ['Gold', 'Green'],
  daily_permit_allowed: true,
  daily_rate: 12.5,
  hours_weekday: { open: '06:00', close: '22:00' },
  hours_saturday: { open: '08:00', close: '18:00' },
  hours_sunday: 'CLOSED',
  ev_charging_stations: 4,
  motorcycle_spaces: 6,
  accessible_spaces: 10,
  short_term_parking_spaces: 0,
  low_emission_spaces: 0,
  pay_stations: 0,
  has_lighting: true,
  has_cameras: true,
  has_emergency_phone: true,
  is_covered: false,
  is_paved: true,
  levels: undefined,
  penetration_rate: 0.15,
  avg_turnover_minutes: 120,
  confidence: 'HIGH',
  timestamp: new Date().toISOString(),
  available: 250,
  occupancy_rate: 0.5,
  fill_status: 'AVAILABLE',
  estimated_occupancy: 250,
  estimated_available: 250,
  raw_occupancy: 250,
  effective_penetration_rate: 0.15,
  advisories: [],
  ...overrides,
});

/** Render inside act() — React 19 requires this */
function renderLot(overrides: Partial<ParkingLotResponse> = {}) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<LotAmenities lot={makeLot(overrides)} />);
  });
  return tree;
}

// ────────────────────── Tests ──────────────────────

describe('LotAmenities', () => {
  it('renders all five section titles', () => {
    const tree = renderLot();
    const texts = collectTexts(tree.root);

    expect(texts).toContain('Lot Information');
    expect(texts).toContain('Permits & Rates');
    expect(texts).toContain('Hours');
    expect(texts).toContain('Special Spaces');
    expect(texts).toContain('Safety & Features');
  });

  it('renders capacity and location description', () => {
    const tree = renderLot({ capacity: 1234, location_description: 'North Campus' });
    const texts = collectTexts(tree.root);

    expect(texts).toContain('Capacity');
    expect(texts.some(t => t.includes('1,234'))).toBe(true);
    expect(texts).toContain('North Campus');
  });

  it('renders type as Surface for uncovered lots', () => {
    const tree = renderLot({ is_covered: false });
    const texts = collectTexts(tree.root);
    expect(texts).toContain('Surface');
  });

  it('renders type as Structure for covered lots', () => {
    const tree = renderLot({ is_covered: true });
    const texts = collectTexts(tree.root);
    expect(texts).toContain('Structure');
  });

  it('renders levels when present and > 0', () => {
    const tree = renderLot({ is_covered: true, levels: 5 });
    const texts = collectTexts(tree.root);
    expect(texts).toContain('Levels');
    expect(texts).toContain('5');
  });

  it('does not render levels when null', () => {
    const tree = renderLot({ levels: undefined });
    const texts = collectTexts(tree.root);
    expect(texts).not.toContain('Levels');
  });

  it('renders building proximity when non-empty', () => {
    const tree = renderLot({ buildings: ['Library', 'ECS'] });
    const texts = collectTexts(tree.root);
    expect(texts).toContain('Near');
    expect(texts).toContain('Library,\nECS');
  });

  it('does not render Near when buildings is empty', () => {
    const tree = renderLot({ buildings: [] });
    const texts = collectTexts(tree.root);
    expect(texts).not.toContain('Near');
  });

  it('renders permit types', () => {
    const tree = renderLot({ permit_types: ['Gold', 'Green', 'Purple'] });
    const texts = collectTexts(tree.root);
    expect(texts).toContain('Gold, Green, Purple');
  });

  it('renders daily rate when daily_permit_allowed with rate', () => {
    const tree = renderLot({ daily_permit_allowed: true, daily_rate: 12.5 });
    const texts = collectTexts(tree.root);
    expect(texts).toContain('$12.50');
  });

  it('renders Available when daily_permit_allowed without rate', () => {
    const tree = renderLot({ daily_permit_allowed: true, daily_rate: undefined });
    const texts = collectTexts(tree.root);
    expect(texts).toContain('Available');
  });

  it('renders Not Available when daily_permit_allowed is false', () => {
    const tree = renderLot({ daily_permit_allowed: false });
    const texts = collectTexts(tree.root);
    expect(texts).toContain('Not Available');
  });

  it('renders weekday hours from object format', () => {
    const tree = renderLot({ hours_weekday: { open: '06:00', close: '22:00' } });
    const texts = collectTexts(tree.root);
    expect(texts).toContain('06:00 – 22:00');
  });

  it('renders CLOSED string hours directly', () => {
    const tree = renderLot({ hours_sunday: 'CLOSED' });
    const texts = collectTexts(tree.root);
    expect(texts).toContain('CLOSED');
  });

  it('renders EV charging station count when > 0', () => {
    const tree = renderLot({ ev_charging_stations: 4 });
    const texts = collectTexts(tree.root);
    expect(texts).toContain('4 stations');
  });

  it('renders singular station when exactly 1', () => {
    const tree = renderLot({ ev_charging_stations: 1 });
    const texts = collectTexts(tree.root);
    expect(texts).toContain('1 station');
  });

  it('renders None when EV charging is 0', () => {
    const tree = renderLot({ ev_charging_stations: 0 });
    const texts = collectTexts(tree.root);
    expect(texts).toContain('None');
  });

  it('renders accessible spaces', () => {
    const tree = renderLot({ accessible_spaces: 10 });
    const texts = collectTexts(tree.root);
    expect(texts).toContain('10 spaces');
  });

  it('renders singular accessible space', () => {
    const tree = renderLot({ accessible_spaces: 1 });
    const texts = collectTexts(tree.root);
    expect(texts).toContain('1 space');
  });

  it('renders motorcycle spaces when > 0', () => {
    const tree = renderLot({ motorcycle_spaces: 6 });
    const texts = collectTexts(tree.root);
    expect(texts).toContain('Motorcycle');
    expect(texts).toContain('6 spaces');
  });

  it('does not render motorcycle row when 0', () => {
    const tree = renderLot({ motorcycle_spaces: 0 });
    const texts = collectTexts(tree.root);
    expect(texts).not.toContain('Motorcycle');
  });

  it('renders short-term spaces when > 0', () => {
    const tree = renderLot({ short_term_parking_spaces: 19 });
    const texts = collectTexts(tree.root);
    expect(texts).toContain('Short-term');
    expect(texts).toContain('19 spaces');
  });

  it('does not render short-term row when 0', () => {
    const tree = renderLot({ short_term_parking_spaces: 0 });
    const texts = collectTexts(tree.root);
    expect(texts).not.toContain('Short-term');
  });

  it('renders low-emission spaces when > 0', () => {
    const tree = renderLot({ low_emission_spaces: 32 });
    const texts = collectTexts(tree.root);
    expect(texts).toContain('Low-emission');
    expect(texts).toContain('32 spaces');
  });

  it('does not render low-emission row when 0', () => {
    const tree = renderLot({ low_emission_spaces: 0 });
    const texts = collectTexts(tree.root);
    expect(texts).not.toContain('Low-emission');
  });

  it('renders pay stations when > 0', () => {
    const tree = renderLot({ pay_stations: 3 });
    const texts = collectTexts(tree.root);
    expect(texts).toContain('Pay stations');
    expect(texts).toContain('3 on-site');
  });

  it('does not render pay-stations row when 0', () => {
    const tree = renderLot({ pay_stations: 0 });
    const texts = collectTexts(tree.root);
    expect(texts).not.toContain('Pay stations');
  });

  it('renders all safety chips', () => {
    const tree = renderLot({
      has_lighting: true,
      has_cameras: false,
      has_emergency_phone: true,
      is_covered: false,
      is_paved: true,
    });
    const texts = collectTexts(tree.root);

    expect(texts).toContain('Lighting');
    expect(texts).toContain('Cameras');
    expect(texts).toContain('Emergency Phone');
    expect(texts).toContain('Open Air');  // is_covered = false
    expect(texts).toContain('Paved');     // is_paved = true
  });

  it('renders Covered chip when is_covered is true', () => {
    const tree = renderLot({ is_covered: true });
    const texts = collectTexts(tree.root);
    expect(texts).toContain('Covered');
  });

  it('renders Unpaved chip when is_paved is false', () => {
    const tree = renderLot({ is_paved: false });
    const texts = collectTexts(tree.root);
    expect(texts).toContain('Unpaved');
  });
});
