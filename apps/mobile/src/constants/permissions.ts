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
  { icon: 'checkmark-circle-outline', text: 'When you enter or leave a campus parking lot' },
  { icon: 'checkmark-circle-outline', text: 'Which lot you parked in (anonymous lot ID only)' },
  { icon: 'close-circle-outline',     text: 'Your exact GPS coordinates — never stored' },
  { icon: 'close-circle-outline',     text: 'Your identity or personal information' },
];
