/**
 * useOnboarding
 *
 * Persists a single AsyncStorage flag so we only show the onboarding
 * flow on first launch.  Returns:
 *   - isLoading    : true while we're reading storage (prevents flash)
 *   - needsOnboarding : true when the user has never completed onboarding
 *   - completeOnboarding : call this when the user taps "Get Started"
 */

import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ONBOARDING_KEY = '@SharkPark:onboardingComplete';

export function useOnboarding() {
  const [isLoading, setIsLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);

  useEffect(() => {
    AsyncStorage.getItem(ONBOARDING_KEY)
      .then((value) => {
        setNeedsOnboarding(value === null);
      })
      .catch(() => {
        // If storage read fails, skip onboarding to avoid blocking the user
        setNeedsOnboarding(false);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const completeOnboarding = useCallback(async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    setNeedsOnboarding(false);
  }, []);

  return { isLoading, needsOnboarding, completeOnboarding };
}
