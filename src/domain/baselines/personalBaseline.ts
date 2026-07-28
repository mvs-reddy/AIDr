/**
 * Personal baseline engine (spec §8.3).
 *
 * Every insight compares a user to their own historical band, never to a
 * population average. Uses median + MAD so a single 30 000-step hike or a
 * mis-worn watch night cannot drag the centre.
 *
 * Hard rule enforced here: below `minObservations`, we return `null`. Callers
 * must then say "not enough information yet" — never invent a trend (§11).
 */

import type { HealthMetricSample, NormalizedSignal, PersonalBaseline, SignalType } from '../models';

export interface BaselineConfig {
  minObservations: number;
  shortWindowDays: number;
  referenceWindowDays: number;
  /** Band half-width in MADs. 1.4826·MAD ≈ 1σ for normal data; 2 MAD ≈ "usual". */
  bandMads: number;
  /** Reject a window whose day-coverage falls below this. */
  minCoverage: number;
}

const DEFAULTS: BaselineConfig = {
  minObservations: 14,
  shortWindowDays: 7,
  referenceWindowDays: 28,
  bandMads: 2,
  minCoverage: 0.5,
};

/** Signals that need more history before any statement is safe. */
const PER_SIGNAL: Partial<Record<SignalType, Partial<BaselineConfig>>> = {
  hrv: { minObservations: 21, referenceWindowDays: 60 },
  vo2max: { minObservations: 5, referenceWindowDays: 90 },
  glucose: { minObservations: 20, bandMads: 2.5 },
  sleepDuration: { minObservations: 10 },
  weight: { minObservations: 8, referenceWindowDays: 90 },
  walkingSpeed: { minObservations: 21, referenceWindowDays: 90 },
  stepLength: { minObservations: 21, referenceWindowDays: 90 },
};

export function configFor(type: SignalType): BaselineConfig {
  return { ...DEFAULTS, ...(PER_SIGNAL[type] ?? {}) };
}

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = s.length >> 1;
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

/** Median absolute deviation. Zero-safe: a flat series yields spread 0. */
export function mad(xs: number[], centre = median(xs)): number {
  if (xs.length === 0) return NaN;
  return median(xs.map((x) => Math.abs(x - centre)));
}

/** Clip extremes to the 5th/95th percentile before aggregating a daily total. */
export function winsorise(xs: number[], p = 0.05): number[] {
  if (xs.length < 5) return xs;
  const s = [...xs].sort((a, b) => a - b);
  const lo = s[Math.floor(s.length * p)];
  const hi = s[Math.ceil(s.length * (1 - p)) - 1];
  return xs.map((x) => Math.min(Math.max(x, lo), hi));
}

interface DailyPoint {
  day: string;
  value: number;
}

/** Collapse samples into one value per local day. */
export function toDaily(
  samples: HealthMetricSample[],
  aggregate: 'sum' | 'mean' | 'min' | 'max',
): DailyPoint[] {
  const byDay = new Map<string, number[]>();
  for (const s of samples) {
    const day = s.start.slice(0, 10);
    const bucket = byDay.get(day) ?? [];
    bucket.push(s.value);
    byDay.set(day, bucket);
  }
  return [...byDay.entries()]
    .map(([day, values]) => ({
      day,
      value:
        aggregate === 'sum' ? values.reduce((a, b) => a + b, 0)
        : aggregate === 'mean' ? values.reduce((a, b) => a + b, 0) / values.length
        : aggregate === 'min' ? Math.min(...values)
        : Math.max(...values),
    }))
    .sort((a, b) => a.day.localeCompare(b.day));
}

export function computeBaseline(
  type: SignalType,
  daily: DailyPoint[],
  now = new Date(),
  overrides?: Partial<BaselineConfig>,
): PersonalBaseline | null {
  const cfg = { ...configFor(type), ...overrides };
  const cutoff = new Date(now.getTime() - cfg.referenceWindowDays * 86_400_000)
    .toISOString()
    .slice(0, 10);

  const window = daily.filter((d) => d.day >= cutoff);
  const coverage = window.length / cfg.referenceWindowDays;

  if (window.length < cfg.minObservations || coverage < cfg.minCoverage) return null;

  const values = winsorise(window.map((d) => d.value));
  const centre = median(values);
  const spread = mad(values, centre);

  return {
    type,
    centre,
    spread,
    lower: centre - cfg.bandMads * spread,
    upper: centre + cfg.bandMads * spread,
    observations: window.length,
    coverage: Math.min(coverage, 1),
    confidence: confidenceScore(coverage, window, now),
    windowDays: cfg.referenceWindowDays,
    computedAt: now.toISOString(),
  };
}

/** coverage × recency. Source quality is applied upstream by the normalizer. */
function confidenceScore(coverage: number, window: DailyPoint[], now: Date): number {
  const last = window[window.length - 1];
  const ageDays = (now.getTime() - new Date(last.day).getTime()) / 86_400_000;
  const recency = ageDays <= 1 ? 1 : ageDays <= 3 ? 0.85 : ageDays <= 7 ? 0.6 : 0.3;
  return Number((Math.min(coverage, 1) * recency).toFixed(2));
}

/** Build the minimized, cloud-safe summary for one signal. */
export function buildNormalizedSignal(
  type: SignalType,
  unit: string,
  daily: DailyPoint[],
  now = new Date(),
): NormalizedSignal | null {
  const cfg = configFor(type);
  const baseline = computeBaseline(type, daily, now);

  const shortCutoff = new Date(now.getTime() - cfg.shortWindowDays * 86_400_000)
    .toISOString()
    .slice(0, 10);
  const recent = daily.filter((d) => d.day >= shortCutoff);
  if (recent.length === 0) return null;

  const aggregate = median(recent.map((d) => d.value));
  const period = `${cfg.shortWindowDays}d`;

  return {
    type,
    period,
    aggregate: round(aggregate),
    unit,
    baseline: baseline ? round(baseline.centre) : null,
    deviation: baseline ? round(aggregate - baseline.centre) : null,
    confidence: baseline
      ? baseline.confidence
      : Number((recent.length / cfg.shortWindowDays).toFixed(2)) * 0.4,
    ref: `signal:${type}:${period}`,
  };
}

function round(n: number): number {
  return Math.abs(n) >= 100 ? Math.round(n) : Number(n.toFixed(1));
}

/**
 * Phrasing helper. The spec forbids "normal / abnormal" for personal signals —
 * that vocabulary belongs only to a laboratory's printed range.
 */
export function describeDeviation(signal: NormalizedSignal): string {
  if (signal.baseline == null || signal.deviation == null) {
    return 'not enough history yet to compare with your usual range';
  }
  if (signal.confidence < 0.4) return 'limited data, so this comparison is uncertain';
  const spreadish = Math.abs(signal.deviation);
  const rel = spreadish / Math.max(Math.abs(signal.baseline), 1);
  if (rel < 0.05) return 'in line with your usual range';
  return signal.deviation > 0 ? 'above your usual range' : 'below your usual range';
}
