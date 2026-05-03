// SharkPark Theme Constants

export const COLORS = {
  // Primary colors
  // `primary` is intentionally a warm amber (Tailwind amber-500) — distinct from
  // the CSULB official gold (#FFB81C) so we don't read as university-branded.
  // `black` below is also intentionally slate (#1f2937), not pure #000, to
  // avoid the CSULB yellow-on-black trade-dress pairing.
  primary: '#F59E0B',
  // `secondary` is slate to complement the amber primary without introducing
  // a third brand hue. Use sparingly for muted accents/dark surfaces.
  secondary: '#374151',

  // Neutral colors
  white: '#ffffff',
  black: '#1f2937',
  lightGray: '#f3f4f6',
  mediumLightGray: '#ababab',
  gray: '#6b7280',
  mediumGray: '#4b5563',
  darkGray: '#374151',
  borderGray: '#e5e7eb',
  toggleGray: '#d1d5db',
  // Cool steel-blue used for "data locked" map pins (lots whose live
  // occupancy is redacted because the user hasn't granted background
  // location). Distinct from the availability palette (green/yellow/red)
  // so users can't misread it as an availability signal, but visually
  // present enough that the lot is still discoverable on the map.
  neutralPin: '#8E9AAF',

  // Warning colors (for events)
  warningLight: '#fef3c7',
  warningBorder: '#fbbf24',
  warningText: '#78350f',
  warningTextSecondary: '#a16207',

  // Error colors (for logout, validation)
  error: '#ef4444',
  errorLight: '#fef2f2',
  errorBorder: '#fecaca',
  errorText: '#dc2626',

  // Background colors
  backgroundLight: '#f5f5f5',
  yellowLight: '#fefce8',
  headerDarkBg: '#374151',

  // Shadow
  shadowDark: '#000',

  // Text colors
  textPrimary: '#111827',
  textFull: '#000000ff',
  borderLight: '#ebeae5ff',
} as const;

export const SPACING = {
  xs: 2,
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  xxl: 24,
  xxxl: 32,
  xxxxl: 44,
} as const;

export const TYPOGRAPHY = {
  fontFamily: {
    regular: 'Inter-Regular',
    medium: 'Inter-Medium',
    semibold: 'Inter-SemiBold',
    bold: 'Inter-Bold',
  },
  fontSize: {
    xxs: 9,
    xxs2: 11,
    xs: 10,
    sm: 12,
    md: 14,
    lg: 15,
    xl: 16,
    xxl: 24,
    xxxl: 28,
    xxxxl: 32,
  },
} as const;

export const SHADOWS = {
  card: {
    shadowColor: COLORS.shadowDark,
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 8,
    elevation: 4,
  },
  cardSubtle: {
    shadowColor: COLORS.shadowDark,
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  fab: {
    shadowColor: COLORS.shadowDark,
    shadowOffset: { width: 0, height: SPACING.sm },
    shadowOpacity: 0.3,
    shadowRadius: 6,
    elevation: 8,
  },
} as const;