import React, { createContext, useContext, useMemo } from 'react';
import { useColorScheme, AccessibilityInfo, useWindowDimensions } from 'react-native';
import { accents, palette, type AccentName, type DarkStyle, type ThemeMode } from './tokens';
import { useSettings } from '../state/settingsStore';

export interface Colors {
  canvas: string;
  surface: string;
  surfaceSunken: string;
  surfaceRaised: string;
  border: string;
  hairline: string;
  ink: string;
  inkSoft: string;
  inkMuted: string;
  onInk: string;
  accent: string;
  accentSoft: string;
  accentDeep: string;
  onAccent: string;
  removedFg: string;
  removedBg: string;
  keptFg: string;
  keptBg: string;
  cautionFg: string;
  cautionBg: string;
}

export interface Theme {
  colors: Colors;
  isDark: boolean;
  accentName: AccentName;
  /** OS "Reduce Motion" — components must collapse animation to 0ms when true. */
  reduceMotion: boolean;
  /** Clamped OS font scale. Layouts switch to stacked variants above 1.35. */
  fontScale: number;
  isLargeText: boolean;
}

const ThemeContext = createContext<Theme | null>(null);

function lightColors(accent: AccentName): Colors {
  const a = accents[accent];
  return {
    canvas: palette.cream[200],
    surface: palette.cream[50],
    surfaceSunken: palette.cream[300],
    surfaceRaised: '#FFFFFF',
    border: palette.cream[400],
    hairline: 'rgba(42,50,39,0.08)',
    ink: palette.ink[800],
    inkSoft: palette.ink[600],
    inkMuted: palette.ink[500],
    onInk: palette.cream[100],
    accent: a.base,
    accentSoft: a.soft,
    accentDeep: a.deep,
    onAccent: '#FFFFFF',
    removedFg: palette.removed.fg,
    removedBg: palette.removed.bg,
    keptFg: palette.kept.fg,
    keptBg: palette.kept.bg,
    cautionFg: palette.caution.fg,
    cautionBg: palette.caution.bg,
  };
}

function darkColors(accent: AccentName, style: DarkStyle): Colors {
  const a = accents[accent];
  const canvas =
    style === 'warmInk'
      ? palette.night.canvasWarm
      : style === 'dim'
        ? palette.night.canvasDim
        : palette.night.canvas;
  // "Elevated" lifts cards off the base; "dim" flattens them; "warm ink" warms both.
  const surface = style === 'dim' ? palette.night.canvas : palette.night.surface;
  return {
    canvas,
    surface,
    surfaceSunken: '#1B1F19',
    surfaceRaised: style === 'dim' ? palette.night.surface : palette.night.surfaceRaised,
    border: palette.night.border,
    hairline: 'rgba(241,236,226,0.10)',
    ink: '#EDE8DE',
    inkSoft: '#B9BEB1',
    inkMuted: '#8D9385',
    onInk: '#171A15',
    accent: lighten(a.base),
    accentSoft: 'rgba(180,85,47,0.20)',
    accentDeep: a.base,
    onAccent: '#FFFFFF',
    removedFg: '#E08B6C',
    removedBg: 'rgba(164,66,39,0.24)',
    keptFg: '#A9BE95',
    keptBg: 'rgba(74,88,66,0.30)',
    cautionFg: '#D9B45E',
    cautionBg: 'rgba(138,97,8,0.26)',
  };
}

/** Raise luminance of an accent so it clears 4.5:1 against the night canvas. */
function lighten(hex: string): string {
  const n = parseInt(hex.slice(1), 16);
  const mix = (c: number) => Math.round(c + (255 - c) * 0.28);
  return `#${[(n >> 16) & 255, (n >> 8) & 255, n & 255].map((c) => mix(c).toString(16).padStart(2, '0')).join('')}`;
}

export function ThemeProvider({ children }: { children: React.ReactNode }) {
  const system = useColorScheme();
  const { fontScale } = useWindowDimensions();
  const mode = useSettings((s) => s.themeMode) as ThemeMode;
  const accent = useSettings((s) => s.accent);
  const darkStyle = useSettings((s) => s.darkStyle);
  const [reduceMotion, setReduceMotion] = React.useState(false);

  React.useEffect(() => {
    let alive = true;
    AccessibilityInfo.isReduceMotionEnabled().then((v) => alive && setReduceMotion(v));
    const sub = AccessibilityInfo.addEventListener('reduceMotionChanged', setReduceMotion);
    return () => {
      alive = false;
      sub.remove();
    };
  }, []);

  const value = useMemo<Theme>(() => {
    const isDark = mode === 'system' ? system === 'dark' : mode === 'dark';
    const clamped = Math.min(Math.max(fontScale, 0.85), 1.9);
    return {
      colors: isDark ? darkColors(accent, darkStyle) : lightColors(accent),
      isDark,
      accentName: accent,
      reduceMotion,
      fontScale: clamped,
      isLargeText: clamped > 1.35,
    };
  }, [mode, system, accent, darkStyle, reduceMotion, fontScale]);

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): Theme {
  const t = useContext(ThemeContext);
  if (!t) throw new Error('useTheme must be used inside <ThemeProvider>');
  return t;
}
