// Threshold percentages aligned with backend OCCUPANCY_THRESHOLDS in constants.ts
const FILLING_PCT = 50; // matches OCCUPANCY_THRESHOLDS.FILLING (0.50)
const NEARLY_FULL_PCT = 75; // matches OCCUPANCY_THRESHOLDS.NEARLY_FULL (0.75)

/**
 * Discrete 3-band occupancy color. Use for category badges or copy-driven
 * UI where the user expects a single named bucket (Available/Filling/Full).
 */
export const getOccupancyColor = (occupancy: number): string => {
  if (occupancy < FILLING_PCT) return '#4ade80';
  if (occupancy < NEARLY_FULL_PCT) return '#fbbf24';
  return '#ef4444';
};

/**
 * HSL → hex helper. Saturation/lightness fixed for consistent visual weight
 * across the spectrum so the gradient reads smoothly without a sudden
 * "wash-out" at the midpoint.
 */
const hslToHex = (h: number, s: number, l: number): string => {
  const sN = s / 100;
  const lN = l / 100;
  const c = (1 - Math.abs(2 * lN - 1)) * sN;
  const hp = h / 60;
  const x = c * (1 - Math.abs((hp % 2) - 1));
  let r1 = 0, g1 = 0, b1 = 0;
  if (hp >= 0 && hp < 1) [r1, g1, b1] = [c, x, 0];
  else if (hp < 2) [r1, g1, b1] = [x, c, 0];
  else if (hp < 3) [r1, g1, b1] = [0, c, x];
  else if (hp < 4) [r1, g1, b1] = [0, x, c];
  else if (hp < 5) [r1, g1, b1] = [x, 0, c];
  else [r1, g1, b1] = [c, 0, x];
  const m = lN - c / 2;
  const toByte = (v: number) =>
    Math.max(0, Math.min(255, Math.round((v + m) * 255)))
      .toString(16)
      .padStart(2, '0');
  return `#${toByte(r1)}${toByte(g1)}${toByte(b1)}`;
};

/**
 * Continuous occupancy color: green (0%) → yellow (~50%) → red (100%).
 * Hue interpolates linearly from 120° to 0° across the input range; the
 * 3-band function above remains the source of truth for discrete copy.
 */
export const getOccupancyColorGradient = (occupancy: number): string => {
  const clamped = Math.max(0, Math.min(100, occupancy));
  const hue = 120 - (clamped / 100) * 120; // 120 (green) -> 0 (red)
  return hslToHex(hue, 75, 50);
};

/**
 * Trend-aware status copy for forecast bars. `current` is the bucket the
 * user is reading; `previous` (when supplied) is the prior hour so the
 * label can describe direction with magnitude instead of just restating
 * the static level the bar height already shows.
 *
 * "Filling" is intentionally avoided as a verb because it collides with
 * the level name; we use rate-of-change copy ("up X% from last hour")
 * which is both more informative and grammatically clean across every
 * level transition.
 */
export const getOccupancyStatusLabel = (
  current: number,
  previous?: number,
): string => {
  const level =
    current >= 95
      ? 'Full'
      : current >= NEARLY_FULL_PCT
        ? 'Nearly Full'
        : current >= FILLING_PCT
          ? 'Filling'
          : 'Available';

  if (previous == null || !Number.isFinite(previous)) return level;

  const delta = Math.round(current - previous);
  if (Math.abs(delta) < 5) return `${level} · holding steady`;
  if (delta > 0) return `${level} · up ${delta}% from last hour`;
  return `${level} · down ${Math.abs(delta)}% from last hour`;
};

/**
 * Picks black or white text for legible contrast against an arbitrary
 * background hex. Uses the WCAG relative-luminance formula and the
 * standard 0.5 cutoff, which lines up with the practical eye test for
 * our gradient: green/yellow stops get dark text, orange/red stops keep
 * white. Accepts `#rgb` or `#rrggbb`.
 */
export const getReadableTextColor = (hex: string): string => {
  const normalized = hex.replace('#', '');
  const expanded =
    normalized.length === 3
      ? normalized.split('').map((c) => c + c).join('')
      : normalized;
  if (expanded.length !== 6) return '#1a1a1a';
  const r = parseInt(expanded.slice(0, 2), 16) / 255;
  const g = parseInt(expanded.slice(2, 4), 16) / 255;
  const b = parseInt(expanded.slice(4, 6), 16) / 255;
  const channel = (c: number) =>
    c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  const luminance =
    0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
  return luminance > 0.5 ? '#1a1a1a' : '#ffffff';
};