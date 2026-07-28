/**
 * AIDr. design tokens.
 *
 * Derived from the reference screens. Every value here is semantic — screens must
 * never reach for a raw hex. Spec §15 requires that colour alone never encodes
 * meaning, so every status token ships with a paired icon/label in the component.
 */

export type AccentName = 'clay' | 'sage' | 'amber' | 'rose';
export type ThemeMode = 'system' | 'light' | 'dark';
export type DarkStyle = 'elevated' | 'warmInk' | 'dim';

/** Raw ramps. Not exported to feature code — consumed by `theme.tsx` only. */
export const palette = {
  cream: {
    50: '#FAF7F1',
    100: '#F5F1E8',
    200: '#F1ECE2', // canvas
    300: '#E9E2D5',
    400: '#DCD3C2',
  },
  ink: {
    900: '#20261E',
    800: '#2A3227', // CTA fill / display type
    700: '#3A4436',
    600: '#5A6355',
    500: '#78806F',
    400: '#9AA091',
  },
  clay: { base: '#B4552F', soft: '#F0DDD2', deep: '#8E4223' },
  sage: { base: '#5F7550', soft: '#DFE5D6', deep: '#48583D' },
  amber: { base: '#A9791B', soft: '#F1E3C6', deep: '#7F5A11' },
  rose: { base: '#9B4F62', soft: '#EFD9DE', deep: '#77394A' },
  // Status ramps are hue-distinct AND always paired with a glyph.
  removed: { fg: '#A44227', bg: '#F2DCD4' },
  kept: { fg: '#4A5842', bg: '#DEE4D5' },
  caution: { fg: '#8A6108', bg: '#F5E7C8' },
  night: {
    canvas: '#171A15',
    canvasWarm: '#1C1A16',
    canvasDim: '#131512',
    surface: '#22261F',
    surfaceRaised: '#2A2F26',
    border: '#333930',
  },
} as const;

export const accents: Record<AccentName, { base: string; soft: string; deep: string; label: string }> = {
  clay: { ...palette.clay, label: 'Clay' },
  sage: { ...palette.sage, label: 'Sage' },
  amber: { ...palette.amber, label: 'Amber' },
  rose: { ...palette.rose, label: 'Rose' },
};

/** 4pt base grid. */
export const space = {
  xxs: 4,
  xs: 8,
  sm: 12,
  md: 16,
  lg: 20,
  xl: 24,
  xxl: 32,
  xxxl: 44,
} as const;

export const radius = {
  chip: 999,
  card: 22,
  cardLarge: 26,
  field: 18,
  cta: 26,
  tabBar: 32,
} as const;

/**
 * Type scale. `size` is the *base* value at Dynamic Type default; every text
 * component multiplies it by the OS font scale and clamps per §15 so that the
 * largest accessibility sizes never clip a card.
 */
export const type = {
  display: { family: 'Newsreader_500Medium', size: 40, lineHeight: 46, letterSpacing: -0.6 },
  displayItalic: { family: 'Newsreader_500Medium_Italic', size: 40, lineHeight: 46, letterSpacing: -0.6 },
  displaySm: { family: 'Newsreader_500Medium', size: 28, lineHeight: 34, letterSpacing: -0.3 },
  title: { family: 'Inter_600SemiBold', size: 19, lineHeight: 25, letterSpacing: -0.2 },
  body: { family: 'Inter_400Regular', size: 16, lineHeight: 23, letterSpacing: 0 },
  bodyMedium: { family: 'Inter_500Medium', size: 16, lineHeight: 23, letterSpacing: 0 },
  caption: { family: 'Inter_400Regular', size: 13.5, lineHeight: 19, letterSpacing: 0 },
  /** Small caps eyebrow — `SECTION LABEL`, `STEP 3 · PRIVACY`. */
  eyebrow: { family: 'Inter_600SemiBold', size: 12.5, lineHeight: 16, letterSpacing: 1.3 },
  mono: { family: 'Inter_500Medium', size: 13, lineHeight: 18, letterSpacing: 0.2 },
} as const;

/** Minimum hit target, spec §15 → 44pt. */
export const HIT_SLOP = { top: 8, bottom: 8, left: 8, right: 8 } as const;
export const MIN_TARGET = 44;

export const elevation = {
  card: {
    shadowColor: '#3A3222',
    shadowOpacity: 0.05,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 3 },
    elevation: 2,
  },
  floating: {
    shadowColor: '#2A2418',
    shadowOpacity: 0.12,
    shadowRadius: 22,
    shadowOffset: { width: 0, height: 8 },
    elevation: 10,
  },
} as const;

/** Calm motion. Every duration here is zeroed when Reduce Motion is on. */
export const motion = {
  quick: 140,
  base: 240,
  settle: 380,
  easing: [0.22, 0.61, 0.36, 1] as const,
} as const;
