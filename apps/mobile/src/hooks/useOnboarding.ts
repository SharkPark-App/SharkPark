/**
 * useOnboarding
 *
 * Persists two AsyncStorage flags so we only show each first-launch screen
 * exactly once.  Returns:
 *   - isLoading            : true while reading storage (prevents flash)
 *   - needsOnboarding      : true when the user has never completed onboarding
 *   - completeOnboarding   : call when user taps "Get Started"
 *   - needsPermissionGate  : true when onboarding is done but permissions
 *                            haven't been prompted yet
 *   - completePermissionGate : call when the permission gate screen is done
 */

import { useState, useEffect, useCallback } from 'react';
import AsyncStorage from '@react-native-async-storage/async-storage';

const ONBOARDING_KEY = '@SharkPark:onboardingComplete';
const PERMISSIONS_KEY = '@SharkPark:permissionGateShown';

export function useOnboarding() {
  const [isLoading, setIsLoading] = useState(true);
  const [needsOnboarding, setNeedsOnboarding] = useState(false);
  const [needsPermissionGate, setNeedsPermissionGate] = useState(false);

  useEffect(() => {
    Promise.all([
      AsyncStorage.getItem(ONBOARDING_KEY),
      AsyncStorage.getItem(PERMISSIONS_KEY),
    ])
      .then(([onboarding, permissions]) => {
        const onboardingDone = onboarding !== null;
        const permissionsDone = permissions !== null;
        setNeedsOnboarding(!onboardingDone);
        // Only show the gate if onboarding is done but permissions haven't
        // been prompted yet (covers the case where user re-opens the app
        // mid-flow after completing onboarding but before the gate fires).
        setNeedsPermissionGate(onboardingDone && !permissionsDone);
      })
      .catch(() => {
        // If storage read fails, skip both screens to avoid blocking the user
        setNeedsOnboarding(false);
        setNeedsPermissionGate(false);
      })
      .finally(() => setIsLoading(false));
  }, []);

  const completeOnboarding = useCallback(async () => {
    await AsyncStorage.setItem(ONBOARDING_KEY, 'true');
    setNeedsOnboarding(false);
    setNeedsPermissionGate(true); // immediately queue the permission gate
  }, []);

  const completePermissionGate = useCallback(async () => {
    await AsyncStorage.setItem(PERMISSIONS_KEY, 'true');
    setNeedsPermissionGate(false);
  }, []);

  return {
    isLoading,
    needsOnboarding,
    completeOnboarding,
    needsPermissionGate,
    completePermissionGate,
  };
}
