import { useLocalize } from 'react-native-localize';

/**
 * Subscribes to OS-level locale / unit / region changes (e.g. the user goes
 * to Settings, switches Temperature from Fahrenheit to Celsius, and comes
 * back). Call this in any component whose render depends on
 * `usesFahrenheit()` / `usesImperialUnits()` / `getDeviceLocale()` — the
 * component will re-render whenever the system value changes, without
 * requiring an app restart.
 *
 * Thin wrapper around `react-native-localize`'s `useLocalize()` hook; we
 * discard the returned API because our display code already reads the same
 * values through `formatTemperature` / `formatDistance`. The hook's only job
 * here is the subscription.
 */
export function useLocalizationSettings(): void {
  useLocalize();
}
