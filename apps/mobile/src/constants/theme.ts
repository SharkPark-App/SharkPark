// SharkPark Theme Constants

export const COLORS = {
  // Primary colors
  primary: '#EBA91B',
  secondary: '#1e40af',

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

export const MAP = {
  // The original map image size in pixels (square dimensions)
  IMAGE_SIZE: 1098,
  // Scale multiplier for map display size relative to screen width
  SCALE_MULTIPLIER: 2.5,
} as const;
