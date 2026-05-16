/**
 * VisitorPricingCard
 *
 * Renders the visitor-facing fee block for a lot (short-term tiers, daily,
 * evening/weekend, and overnight where eligible) and offers a one-tap
 * deep-link into the ParkMobile app for paying remotely.
 *
 * Data source: the `applied_fees` field on `ParkingLotResponse`, populated
 * on the backend from `CSULB_PERMIT_FEES` + per-lot eligibility (see
 * apps/backend/src/lots/permit-fees.ts). The card renders nothing when
 * the lot has no eligible visitor fees AND no ParkMobile coverage —
 * that case never happens today (every lot honours evening/weekend), but
 * the guard keeps the card defensive against backend additions.
 *
 * Deep link strategy: prefer a lot-specific zone over the umbrella zone
 * (3993 / 3975) via `pickPreferredParkMobileZone`, then open
 * `https://app.parkmobile.io/?zone={zone}` — the universal-link target
 * resolves to the native ParkMobile app if installed, otherwise the
 * mobile web flow. We never silently swallow `Linking` rejections —
 * the user gets an Alert so they know to install ParkMobile.
 */
import React from 'react';
import { View, StyleSheet, Pressable, Alert, Linking } from 'react-native';
import Icon from 'react-native-vector-icons/Ionicons';
import { Text } from './CustomText';
import { TYPOGRAPHY, SPACING, SHADOWS } from '../constants/theme';
import { useTheme } from '../context/ThemeContext';
import type { ParkingLotResponse } from '../services/api/lots';
import { pickPreferredParkMobileZone } from '../services/api/lots';

interface VisitorPricingCardProps {
  lot: Pick<ParkingLotResponse, 'lot_id' | 'applied_fees' | 'park_mobile_zones'>;
}

const PARKMOBILE_DEEP_LINK = (zone: string) => `https://app.parkmobile.io/?zone=${zone}`;

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
  const preferredZone = pickPreferredParkMobileZone(lot.park_mobile_zones);

  // Defensive: skip rendering when there's truly nothing to show.
  // evening_weekend is always present today, so this branch should never
  // execute in production — kept for future-proofing.
  if (
    !fees.short_term &&
    fees.daily == null &&
    !fees.overnight &&
    !fees.evening_weekend &&
    !preferredZone
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

      {preferredZone && (
        <Pressable
          onPress={() => openParkMobile(preferredZone)}
          accessibilityRole="button"
          accessibilityLabel={`Pay with ParkMobile, zone ${preferredZone}`}
          style={({ pressed }) => [
            styles.button,
            { backgroundColor: pressed ? '#0b8f4a' : '#10b981' },
          ]}
        >
          <Icon name="card-outline" size={18} color="#ffffff" />
          <Text style={styles.buttonText}>
            Pay with ParkMobile (Zone {preferredZone})
          </Text>
        </Pressable>
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
    justifyContent: 'center',
    gap: SPACING.sm,
    paddingVertical: SPACING.md,
    paddingHorizontal: SPACING.lg,
    borderRadius: SPACING.md,
    marginTop: SPACING.sm,
  },
  buttonText: {
    color: '#ffffff',
    fontSize: TYPOGRAPHY.fontSize.md,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
  },
});
