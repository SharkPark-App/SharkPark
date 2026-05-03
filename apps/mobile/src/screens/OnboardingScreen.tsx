/**
 * OnboardingScreen
 *
 * First-launch tutorial with 4 slides:
 *   1. Welcome
 *   2. How it works — occupancy crowdsourcing
 *   3. Forecasts & reliability
 *   4. Permission priming — explains the optional background-location
 *      upgrade and the iOS two-step "While Using" → "Always" flow BEFORE
 *      the OS dialog fires from EnhancedGeofencingProvider.
 *
 * Renders a horizontal FlatList of slides driven exclusively by the
 * "Next" / "Get Started" CTA (swipe is disabled to keep slide order
 * deterministic and the dot indicator in sync). No react-navigation
 * dependency — parent simply conditionally renders this screen.
 */

import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Dimensions,
  Platform,
  StatusBar,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import Icon from 'react-native-vector-icons/Ionicons';
import { Text } from '../components/CustomText';
import { COLORS, SPACING, TYPOGRAPHY } from '../constants/theme';
import { LOCATION_DATA_POINTS, DataPoint } from '../constants/permissions';
import sharkParkLogo from '../assets/images/SharkParkV4.webp';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── slide data ────────────────────────────────────────────────────────────

interface Slide {
  key: string;
  emoji: string | null;
  title: string;
  body: string;
  /** Optional bullet list rendered between body and note (used on the permissions slide). */
  bullets?: DataPoint[];
  /** Shown below the body only on the last slide */
  note?: string;
}

const SLIDES: Slide[] = [
  {
    key: 'welcome',
    emoji: null,
    title: 'Welcome to SharkPark',
    body: 'An independent student-built app (not affiliated with CSULB) that shows real-time parking availability across campus — so you spend less time circling and more time in class.',
  },
  {
    key: 'crowdsource',
    emoji: null,
    title: 'Crowdsourced Occupancy',
    body: 'Every SharkPark user automatically contributes anonymous lot entry and exit events. The more users, the more accurate the map.',
  },
  {
    key: 'forecast',
    emoji: null,
    title: 'Predict the Future',
    body: 'Short-term and long-term forecasts show you how busy each lot is expected to be — before you even leave home.',
  },
  {
    key: 'permissions',
    emoji: '📍',
    title: 'Optional: Help Power the Map',
    body: 'You can browse lots, directions, and shuttle info without granting any permissions. Sharing background location is optional — it unlocks live occupancy and forecasts by anonymously contributing your own lot entry/exit events.',
    bullets: LOCATION_DATA_POINTS,
    note: 'iOS asks in two steps: first "Allow While Using" so you can try it out, then later offers "Always Allow" for background detection. You can change your mind anytime in Settings.',
  },
];

// ─── component ─────────────────────────────────────────────────────────────

interface OnboardingScreenProps {
  onComplete: () => void;
}

export function OnboardingScreen({ onComplete }: OnboardingScreenProps) {
  const [activeIndex, setActiveIndex] = useState(0);
  const flatListRef = useRef<FlatList<Slide>>(null);

  const isLast = activeIndex === SLIDES.length - 1;

  const handleNext = useCallback(() => {
    if (isLast) {
      onComplete();
      return;
    }
    const nextIndex = activeIndex + 1;
    flatListRef.current?.scrollToIndex({ index: nextIndex, animated: true });
    setActiveIndex(nextIndex);
  }, [activeIndex, isLast, onComplete]);

  const handleSkip = useCallback(() => {
    onComplete();
  }, [onComplete]);

  const renderSlide = useCallback(({ item }: { item: Slide }) => (
    <View style={styles.slide}>
      {item.emoji === null ? (
        <Image
          source={sharkParkLogo}
          style={styles.logo}
          resizeMode="contain"
        />
      ) : (
        <Text style={styles.emoji}>{item.emoji}</Text>
      )}
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.body}>{item.body}</Text>
      {item.bullets ? (
        <View style={styles.bulletList}>
          {item.bullets.map((point) => (
            <View key={point.text} style={styles.bulletRow}>
              <Icon
                name={point.icon}
                size={18}
                color={point.icon.startsWith('checkmark') ? '#10b981' : COLORS.mediumGray}
                style={styles.bulletIcon}
              />
              <Text style={styles.bulletText}>{point.text}</Text>
            </View>
          ))}
        </View>
      ) : null}
      {item.note ? (
        <View style={styles.noteBox}>
          <Text style={styles.noteText}>{item.note}</Text>
        </View>
      ) : null}
    </View>
  ), []);

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor={COLORS.white} />

      {/* Skip button — hidden on last slide */}
      <View style={styles.skipRow}>
        {!isLast ? (
          <TouchableOpacity onPress={handleSkip} hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}>
            <Text style={styles.skipText}>Skip</Text>
          </TouchableOpacity>
        ) : (
          <View />
        )}
      </View>

      {/* Slides */}
      <FlatList
        ref={flatListRef}
        data={SLIDES}
        renderItem={renderSlide}
        keyExtractor={(item) => item.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        scrollEnabled={false}  // controlled programmatically
        getItemLayout={(_, index) => ({
          length: SCREEN_WIDTH,
          offset: SCREEN_WIDTH * index,
          index,
        })}
      />

      {/* Dot indicators */}
      <View style={styles.dotsRow}>
        {SLIDES.map((_, i) => (
          <View
            key={i}
            style={[styles.dot, i === activeIndex ? styles.dotActive : styles.dotInactive]}
          />
        ))}
      </View>

      {/* CTA button */}
      <TouchableOpacity
        style={styles.ctaButton}
        onPress={handleNext}
        activeOpacity={0.85}
      >
        <Text style={styles.ctaText}>
          {isLast ? 'Get Started' : 'Next'}
        </Text>
      </TouchableOpacity>

      {/* Bottom breathing room for home indicator */}
      <View style={{ height: Platform.OS === 'ios' ? SPACING.lg : SPACING.xxl }} />
    </SafeAreaView>
  );
}

// ─── styles ────────────────────────────────────────────────────────────────

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: COLORS.white,
  },
  skipRow: {
    alignItems: 'flex-end',
    paddingHorizontal: SPACING.xxl,
    paddingTop: SPACING.md,
    minHeight: 40,
  },
  skipText: {
    fontSize: TYPOGRAPHY.fontSize.md,
    color: COLORS.mediumGray,
    fontFamily: TYPOGRAPHY.fontFamily.medium,
  },
  slide: {
    width: SCREEN_WIDTH,
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: SPACING.xxxl,
  },
  emoji: {
    fontSize: 72,
    marginBottom: SPACING.xxl,
  },
  logo: {
    width: 180,
    height: 180,
    marginBottom: SPACING.xxl,
  },
  title: {
    fontSize: TYPOGRAPHY.fontSize.xxxl,
    fontFamily: TYPOGRAPHY.fontFamily.bold,
    color: COLORS.textPrimary,
    textAlign: 'center',
    marginBottom: SPACING.xl,
  },
  body: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    color: COLORS.mediumGray,
    textAlign: 'center',
    lineHeight: 24,
  },
  noteBox: {
    marginTop: SPACING.xxl,
    backgroundColor: COLORS.yellowLight,
    borderRadius: SPACING.md,
    borderWidth: 1,
    borderColor: COLORS.warningBorder,
    paddingHorizontal: SPACING.xl,
    paddingVertical: SPACING.lg,
  },
  noteText: {
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.warningText,
    textAlign: 'center',
    lineHeight: 18,
  },
  bulletList: {
    marginTop: SPACING.lg,
    width: '100%',
    gap: SPACING.sm,
  },
  bulletRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
  },
  bulletIcon: {
    marginRight: SPACING.sm,
    marginTop: 2,
  },
  bulletText: {
    flex: 1,
    fontSize: TYPOGRAPHY.fontSize.sm,
    color: COLORS.darkGray,
    lineHeight: 20,
  },

  // ── dots
  dotsRow: {
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: SPACING.xxl,
    gap: SPACING.sm,
  },
  dot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  dotActive: {
    backgroundColor: COLORS.primary,
    width: 20,
  },
  dotInactive: {
    backgroundColor: COLORS.toggleGray,
  },

  // ── CTA
  ctaButton: {
    marginHorizontal: SPACING.xxxl,
    backgroundColor: COLORS.primary,
    borderRadius: SPACING.md,
    paddingVertical: SPACING.lg,
    alignItems: 'center',
  },
  ctaText: {
    fontSize: TYPOGRAPHY.fontSize.lg,
    fontFamily: TYPOGRAPHY.fontFamily.semibold,
    color: COLORS.white,
  },
});
