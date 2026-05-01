/**
 * Single source of truth for the location-permission privacy disclosures
 * shown to users. Rendered as bullet points on:
 *   - OnboardingScreen (permissions slide, soft introduction)
 *   - LocationPermissionScreen (explain step, just before OS dialog)
 *
 * Keep these two surfaces aligned by importing this constant in both
 * places — do NOT inline a copy.
 */

export interface DataPoint {
  /** Ionicons name. `checkmark-*` = collected, `close-*` = not collected. */
  icon: string;
  text: string;
}

export const LOCATION_DATA_POINTS: DataPoint[] = [
  { icon: 'checkmark-circle-outline', text: 'Lot entry/exit events (just the anonymous lot ID + a timestamp)' },
  { icon: 'checkmark-circle-outline', text: 'A short-lived random device ID so we can dedupe contributions' },
  { icon: 'close-circle-outline',     text: 'Your GPS coordinates — never sent or stored on our servers' },
  { icon: 'close-circle-outline',     text: 'Your name, email, or any data tying events back to you' },
  { icon: 'close-circle-outline',     text: 'A location history, breadcrumb trail, or "where you\'ve been" log' },
];
