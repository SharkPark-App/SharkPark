/**
 * VisitorPricingCard
 *
 * Renders the visitor-facing fee block for a lot (short-term tiers, daily,
 * evening/weekend, and overnight where eligible) and offers one-tap
 * deep-links into the ParkMobile app for paying remotely.
 *
 * Data source: the `applied_fees` field on `ParkingLotResponse`, populated
 * on the backend from `CSULB_PERMIT_FEES` + per-lot eligibility (see
 * apps/backend/src/lots/permit-fees.ts). The card renders nothing when
 * the lot has no eligible visitor fees AND no ParkMobile coverage —
 * that case never happens today (every lot honours evening/weekend), but
 * the guard keeps the card defensive against backend additions.
 *
 * Deep link strategy: ParkMobile's universal-link format is
 * `https://app.parkmobile.io/zone/932{zone}` — the leading `932` is
 * ParkMobile's CSULB site prefix (verified by tapping zones on-device).
 * The universal link resolves to the native ParkMobile app if installed,
 * otherwise the mobile web flow. We render ONE button per published zone
 * (lots commonly have a lot-specific zone + the umbrella zone) labelled
 * with what the zone covers, so users can pick the right one for their
 * parking situation. We never silently swallow `Linking` rejections —
 * the user gets an Alert so they know to install ParkMobile.
 */
import React from 'react';
import { View, StyleSheet, Pressable, Alert, Linking } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { Text } from './CustomText';
import { TYPOGRAPHY, SPACING, SHADOWS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import type { ParkingLotResponse } from '../services/api/lots';
import { UMBRELLA_PARKMOBILE_ZONES } from '../services/api/lots';

interface VisitorPricingCardProps {
  lot: Pick<ParkingLotResponse, 'lot_id' | 'applied_fees' | 'park_mobile_zones'>;
}

/**
 * ParkMobile's CSULB-site zones are addressed in the universal link as
 * `932` + the publicly-posted zone number (e.g. published zone `3993`
 * resolves to URL zone `9323993`). Confirmed by tapping live signage
 * links on-device.
 */
const PARKMOBILE_DEEP_LINK = (zone: string) => `https://app.parkmobile.io/zone/932${zone}`;

/**
 * Human-readable description of what a given ParkMobile zone covers.
 * The two umbrella zones have CSULB-wide semantics; all other zones are
 * lot-specific designated ("green") spaces.
 */
function zoneCoverageLabel(zone: string): string {
  if (zone === '3993') return 'General spaces (any G lot)';
  if (zone === '3975') return 'Employee spaces (after 5:30 PM / weekends)';
  return 'Designated green spaces in this lot';
}

function formatMinutes(min: number): string {
  if (min < 60) return `${min} min`;
  const h = Math.floor(min / 60);
  const rem = min % 60;
  return rem === 0 ? `${h} hr` : `${h} hr ${rem} min`;
}

async function openParkMobile(zone: string) {
  const url = PARKMOBILE_DEEP_LINK(zone);
  try {
    await Linking.openURL(url);
  } catch (err) {
    console.warn('[VisitorPricingCard] Failed to open ParkMobile:', err);
    Alert.alert(
      'Could not open ParkMobile',
      'Install the ParkMobile app from the App Store, then try again.',
    );
  }
}

export function VisitorPricingCard({ lot }: VisitorPricingCardProps) {
  const { colors } = useTheme();
  const fees = lot.applied_fees;
  // Order zones so lot-specific zones come first (they're usually the
  // user's intent when standing in front of a designated green space);
  // umbrella zones (3993, 3975) fall to the bottom.
  const orderedZones = [...lot.park_mobile_zones].sort((a, b) => {
    const aUmbrella = UMBRELLA_PARKMOBILE_ZONES.has(a) ? 1 : 0;
    const bUmbrella = UMBRELLA_PARKMOBILE_ZONES.has(b) ? 1 : 0;
    return aUmbrella - bUmbrella;
  });
  const hasZones = orderedZones.length > 0;

  // Defensive: skip rendering when there's truly nothing to show.
  // evening_weekend is always present today, so this branch should never
  // execute in production — kept for future-proofing.
  if (
    !fees.short_term &&
    fees.daily == null &&
    !fees.overnight &&
    !fees.evening_weekend &&
    !hasZones
  ) {
    return null;
  }

  return (
    <View
      style={[styles.card, { backgroundColor: colors.white, shadowColor: colors.shadowDark }]}
      accessibilityLabel={`Visitor pricing for lot ${lot.lot_id}`}
    >
      <Text style={[styles.sectionTitle, { color: colors.textPrimary }]}>
        Visitor Pricing
      </Text>

      {fees.short_term && fees.short_term.length > 0 && (
        <View style={styles.block}>
          <View style={styles.blockHeader}>
            <Icon name="time-outline" size={18} color={colors.gray} />
            <Text style={[styles.blockTitle, { color: colors.textPrimary }]}>
              Short-term
            </Text>
          </View>
          {fees.short_term.map((tier) => (
            <View key={tier.max_minutes} style={styles.row}>
              <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>
                Up to {formatMinutes(tier.max_minutes)}
              </Text>
              <Text style={[styles.rowValue, { color: colors.textPrimary }]}>
                ${tier.price.toFixed(2)}
              </Text>
            </View>
          ))}
        </View>
      )}

      {fees.daily != null && (
        <View style={styles.block}>
          <View style={styles.blockHeader}>
            <Icon name="sunny-outline" size={18} color={colors.gray} />
            <Text style={[styles.blockTitle, { color: colors.textPrimary }]}>
              Daily Permit
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>
              All day
            </Text>
            <Text style={[styles.rowValue, { color: colors.textPrimary }]}>
              ${fees.daily.toFixed(2)}
            </Text>
          </View>
        </View>
      )}

      <View style={styles.block}>
        <View style={styles.blockHeader}>
          <Icon name="moon-outline" size={18} color={colors.gray} />
          <Text style={[styles.blockTitle, { color: colors.textPrimary }]}>
            Evening & Weekend
          </Text>
        </View>
        <View style={styles.row}>
          <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>
            {fees.evening_weekend.conditions}
          </Text>
          <Text style={[styles.rowValue, { color: colors.textPrimary }]}>
            ${fees.evening_weekend.price.toFixed(2)}
          </Text>
        </View>
      </View>

      {fees.overnight && (
        <View style={styles.block}>
          <View style={styles.blockHeader}>
            <Icon name="bed-outline" size={18} color={colors.gray} />
            <Text style={[styles.blockTitle, { color: colors.textPrimary }]}>
              Overnight
            </Text>
          </View>
          <View style={styles.row}>
            <Text style={[styles.rowLabel, { color: colors.textPrimary }]}>
              Increments
            </Text>
            <Text style={[styles.rowValue, { color: colors.textPrimary }]}>
              {fees.overnight.increments_hours.map((h) => `${h}h`).join(' / ')}
            </Text>
          </View>
          <Text style={[styles.note, { color: colors.gray }]}>
            {fees.overnight.price_note}
          </Text>
        </View>
      )}

      {hasZones && (
        <View style={styles.zoneButtons}>
          {orderedZones.map((zone) => (
            <Pressable
              key={zone}
              onPress={() => openParkMobile(zone)}
              accessibilityRole="button"
              accessibilityLabel={`Pay with ParkMobile, zone ${zone}`}
              style={({ pressed }) => [
                styles.button,
                { backgroundColor: pressed ? '#0b8f4a' : '#10b981' },
              ]}
            >
              <Icon name="card-outline" size={18} color="#ffffff" />
              <View style={styles.buttonTextWrap}>
                <Text style={styles.buttonText}>
                  Pay with ParkMobile (Zone {zone})
                </Text>
                <Text style={styles.buttonSubtext}>
                  {zoneCoverageLabel(zone)}
                </Text>
              </View>
            </Pressable>
          ))}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  card: {
    borderRadius: SPACING.lg,
    padding: SPACING.xl,
    marginHorizontal: SPACING.lg,
    marginTop: SPACING.lg,
    ...SHADOWS.card,
  },
  sectionTitle: {
    fontSize: TYPOGRAPHY.fontSize.xl,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    marginBottom: SPACING.lg,
  },
  block: {
    marginBottom: SPACING.lg,
  },
  blockHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: SPACING.sm,
    marginBottom: SPACING.sm,
  },
  blockTitle: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
  row: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: SPACING.sm,
  },
  rowLabel: {
    fontSize: TYPOGRAPHY.fontSize.md,
    flex: 1,
  },
  rowValue: {
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
  note: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    marginTop: SPACING.xs,
    fontStyle: 'italic',
  },
  button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'flex-start',
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: SPACING.md,
    marginTop: SPACING.sm,
  },
  buttonTextWrap: {
    flex: 1,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
  buttonSubtext: {
    color: '#ffffff',
    fontSize: TYPOGRAPHY.fontSize.sm,
    opacity: 0.9,
    marginTop: 2,
  },
  zoneButtons: {
    marginTop: SPACING.sm,
  },
});
