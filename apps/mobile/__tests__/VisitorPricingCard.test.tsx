/**
 * VisitorPricingCard Component Tests
 *
 * Verifies:
 *   - Short-term tiers render when applied_fees.short_term is populated
 *   - Daily row renders only when applied_fees.daily is non-null
 *   - Evening & weekend always renders (with conditions text)
 *   - Overnight block renders only when applied_fees.overnight is non-null
 *   - ParkMobile button hidden when park_mobile_zones is empty
 *   - pickPreferredParkMobileZone correctly prefers non-umbrella zones
 *   - Tapping ParkMobile button calls Linking.openURL with the correct URL
 */
import React from 'react';
import ReactTestRenderer from 'react-test-renderer';
import { Linking } from 'react-native';

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

import { VisitorPricingCard } from '../src/components/VisitorPricingCard';
import type { AppliedFees, ParkingLotResponse } from '../src/services/api/lots';
import { collectTexts } from './testUtils';

// ────────────────────── Helpers ──────────────────────

const FULL_FEES: AppliedFees = {
  short_term: [
    { max_minutes: 30, price: 4 },
    { max_minutes: 60, price: 6 },
    { max_minutes: 90, price: 10 },
  ],
  daily: 15,
  evening_weekend: {
    price: 10,
    conditions: 'After 5:30 PM Mon–Fri; all day Sat–Sun',
  },
  overnight: {
    available_at_lots: ['G2'],
    increments_hours: [24, 48, 72],
    price_note: 'Daily-rate increments; pay in ParkMobile',
  },
};

type CardLot = Pick<ParkingLotResponse, 'lot_id' | 'applied_fees' | 'park_mobile_zones'>;

const makeLot = (overrides: Partial<CardLot> = {}): CardLot => ({
  lot_id: 'G2',
  applied_fees: FULL_FEES,
  park_mobile_zones: ['3993'],
  ...overrides,
});

function renderCard(lot: CardLot) {
  let tree!: ReactTestRenderer.ReactTestRenderer;
  ReactTestRenderer.act(() => {
    tree = ReactTestRenderer.create(<VisitorPricingCard lot={lot} />);
  });
  return tree;
}

// ────────────────────── Tests ──────────────────────

describe('VisitorPricingCard', () => {
  beforeEach(() => {
    jest.restoreAllMocks();
  });

  it('renders section title', () => {
    const tree = renderCard(makeLot());
    expect(collectTexts(tree.root)).toContain('Visitor Pricing');
  });

  it('renders all short-term tiers when present', () => {
    const tree = renderCard(makeLot());
    const texts = collectTexts(tree.root);
    expect(texts).toContain('Short-term');
    expect(texts).toContain('Up to 30 min');
    expect(texts).toContain('Up to 1 hr');
    expect(texts).toContain('Up to 1 hr 30 min');
    expect(texts).toContain('$4.00');
    expect(texts).toContain('$6.00');
    expect(texts).toContain('$10.00');
  });

  it('renders daily row when applied_fees.daily is set', () => {
    const tree = renderCard(makeLot());
    const texts = collectTexts(tree.root);
    expect(texts).toContain('Daily Permit');
    expect(texts).toContain('$15.00');
  });

  it('hides daily block when applied_fees.daily is null', () => {
    const tree = renderCard(
      makeLot({ applied_fees: { ...FULL_FEES, daily: null } }),
    );
    expect(collectTexts(tree.root)).not.toContain('Daily Permit');
  });

  it('always renders evening & weekend block with conditions', () => {
    const tree = renderCard(makeLot());
    const texts = collectTexts(tree.root);
    expect(texts).toContain('Evening & Weekend');
    expect(texts).toContain('After 5:30 PM Mon–Fri; all day Sat–Sun');
  });

  it('renders overnight block only when applied_fees.overnight is set', () => {
    const withOvernight = renderCard(makeLot());
    expect(collectTexts(withOvernight.root)).toContain('Overnight');

    const withoutOvernight = renderCard(
      makeLot({ applied_fees: { ...FULL_FEES, overnight: null } }),
    );
    expect(collectTexts(withoutOvernight.root)).not.toContain('Overnight');
  });

  it('hides ParkMobile button when park_mobile_zones is empty', () => {
    const tree = renderCard(makeLot({ park_mobile_zones: [] }));
    const texts = collectTexts(tree.root);
    expect(texts.some(t => t.startsWith('Pay with ParkMobile'))).toBe(false);
  });

  it('prefers a specific zone over umbrella zones (3993 / 3975)', () => {
    // Multi-zone lot — both buttons render, but the lot-specific zone is
    // listed FIRST so it's the most prominent CTA.
    const tree = renderCard(makeLot({ park_mobile_zones: ['3993', '3921'] }));
    const texts = collectTexts(tree.root);
    expect(texts).toContain('Pay with ParkMobile (Zone 3921)');
    expect(texts).toContain('Pay with ParkMobile (Zone 3993)');
    const specificIdx = texts.indexOf('Pay with ParkMobile (Zone 3921)');
    const umbrellaIdx = texts.indexOf('Pay with ParkMobile (Zone 3993)');
    expect(specificIdx).toBeLessThan(umbrellaIdx);
  });

  it('falls back to umbrella zone when no specific zone is available', () => {
    const tree = renderCard(makeLot({ park_mobile_zones: ['3993'] }));
    const texts = collectTexts(tree.root);
    expect(texts).toContain('Pay with ParkMobile (Zone 3993)');
  });

  it('renders descriptive coverage labels for umbrella vs lot-specific zones', () => {
    const tree = renderCard(makeLot({ park_mobile_zones: ['3921', '3993', '3975'] }));
    const texts = collectTexts(tree.root);
    expect(texts).toContain('Designated green spaces in this lot');
    expect(texts).toContain('General spaces (any G lot)');
    expect(texts).toContain('Employee spaces (after 5:30 PM / weekends)');
  });

  it('opens ParkMobile deep link with selected zone on button press', async () => {
    const openSpy = jest
      .spyOn(Linking, 'openURL')
      .mockResolvedValue(true as unknown as void);

    const tree = renderCard(makeLot({ park_mobile_zones: ['3921'] }));

    // Locate the Pressable that owns the button accessibility label
    const button = tree.root.findAll(
      node =>
        node.props?.accessibilityLabel === 'Pay with ParkMobile, zone 3921' &&
        typeof node.props?.onPress === 'function',
    )[0];
    expect(button).toBeTruthy();

    await ReactTestRenderer.act(async () => {
      await button.props.onPress();
    });

    // ParkMobile's CSULB site prefix is `932`, so published zone 3921
    // resolves to URL zone 9323921.
    expect(openSpy).toHaveBeenCalledWith('https://app.parkmobile.io/zone/9323921');
  });
});
