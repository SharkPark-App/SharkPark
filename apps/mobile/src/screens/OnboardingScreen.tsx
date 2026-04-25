/**
 * OnboardingScreen
 *
 * First-launch tutorial with 4 slides:
 *   1. Welcome
 *   2. How it works — occupancy crowdsourcing
 *   3. Forecasts & reliability
 *   4. Permission priming — explains why "Always Allow" is needed BEFORE
 *      the OS dialog fires from EnhancedGeofencingProvider
 *
 * Renders a horizontal FlatList of slides so the user can swipe or tap
 * "Next" / "Get Started".  No react-navigation dependency — parent
 * simply conditionally renders this screen.
 */

import React, { useRef, useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  FlatList,
  TouchableOpacity,
  Dimensions,
  Platform,
  StatusBar,
  Image,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { COLORS, SPACING, TYPOGRAPHY } from '../constants/theme';

const { width: SCREEN_WIDTH } = Dimensions.get('window');

// ─── slide data ────────────────────────────────────────────────────────────

interface Slide {
  key: string;
  emoji: string | null;
  title: string;
  body: string;
  /** Shown below the body only on the last slide */
  note?: string;
}

const SLIDES: Slide[] = [
  {
    key: 'welcome',
    emoji: null,
    title: 'Welcome to SharkPark',
    body: 'Find real-time parking availability across CSULB — so you spend less time circling and more time in class.',
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
    title: 'One Permission, Big Impact',
    body: 'SharkPark needs "Always Allow" location access to detect when you enter and exit parking lots in the background — even when the app is closed.',
    note: 'Your exact location is never stored. Only anonymous "entered lot / left lot" events are shared.',
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
          source={require('../assets/images/SharkParkV4.webp')}
          style={styles.logo}
          resizeMode="contain"
        />
      ) : (
        <Text style={styles.emoji}>{item.emoji}</Text>
      )}
      <Text style={styles.title}>{item.title}</Text>
      <Text style={styles.body}>{item.body}</Text>
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
    fontWeight: TYPOGRAPHY.fontWeight.medium,
  },

  // ── slide
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
    fontWeight: TYPOGRAPHY.fontWeight.bold,
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
    fontWeight: TYPOGRAPHY.fontWeight.semibold,
    color: COLORS.white,
  },
});
