/**
 * Baseline maths (spec §8.3). The critical property is the minimum-data gate:
 * with thin history the engine must return null so the UI says "not enough
 * information" rather than inventing a trend (§11).
 */

import {
  median,
  mad,
  winsorise,
  computeBaseline,
  describeDeviation,
  toDaily,
} from '../../domain/baselines/personalBaseline';
import type { HealthMetricSample } from '../../domain/models';

const daily = (values: number[], from = new Date('2026-06-01')) =>
  values.map((value, i) => ({
    day: new Date(from.getTime() + i * 86_400_000).toISOString().slice(0, 10),
    value,
  }));

describe('robust statistics', () => {
  it('computes median for odd and even lengths', () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 3, 2])).toBe(2.5);
  });

  it('resists a single extreme value', () => {
    const normal = daily(Array(30).fill(7000));
    const withHike = daily([...Array(29).fill(7000), 42000]);
    const a = computeBaseline('steps', normal, new Date('2026-07-01'));
    const b = computeBaseline('steps', withHike, new Date('2026-07-01'));
    // A mean would jump by well over 1000; the winsorised median must not.
    expect(Math.abs(a!.centre - b!.centre)).toBeLessThan(50);
  });

  it('winsorises without changing length', () => {
    const out = winsorise([1, 2, 3, 4, 100]);
    expect(out).toHaveLength(5);
    expect(Math.max(...out)).toBeLessThan(100);
  });

  it('handles a flat series without dividing by zero', () => {
    expect(mad([5, 5, 5, 5])).toBe(0);
  });
});

describe('minimum-data gates', () => {
  it('returns null below the observation floor', () => {
    expect(computeBaseline('steps', daily(Array(5).fill(7000)), new Date('2026-06-10'))).toBeNull();
  });

  it('requires more history for HRV than for steps', () => {
    const twoWeeks = daily(Array(16).fill(45));
    const now = new Date('2026-06-20');
    expect(computeBaseline('steps', twoWeeks, now)).not.toBeNull();
    expect(computeBaseline('hrv', twoWeeks, now)).toBeNull();
  });

  it('returns null when coverage is too sparse', () => {
    const sparse = daily(Array(30).fill(7000)).filter((_, i) => i % 4 === 0);
    expect(computeBaseline('steps', sparse, new Date('2026-07-01'))).toBeNull();
  });
});

describe('deviation language', () => {
  const signal = (baseline: number | null, aggregate: number, confidence = 0.8) => ({
    type: 'steps' as const,
    period: '7d',
    aggregate,
    unit: 'count',
    baseline,
    deviation: baseline == null ? null : aggregate - baseline,
    confidence,
    ref: 'signal:steps:7d',
  });

  it('never says normal or abnormal', () => {
    const phrases = [
      describeDeviation(signal(7000, 9000)),
      describeDeviation(signal(7000, 5000)),
      describeDeviation(signal(7000, 7050)),
      describeDeviation(signal(null, 7000)),
    ];
    for (const p of phrases) {
      expect(p).not.toMatch(/\b(normal|abnormal)\b/i);
    }
  });

  it('admits when there is no baseline', () => {
    expect(describeDeviation(signal(null, 7000))).toMatch(/not enough history/i);
  });

  it('flags low confidence rather than asserting a trend', () => {
    expect(describeDeviation(signal(7000, 12000, 0.2))).toMatch(/uncertain/i);
  });
});

describe('daily aggregation', () => {
  it('sums multiple samples within one local day', () => {
    const samples: HealthMetricSample[] = [1, 2, 3].map((n) => ({
      id: `s${n}`,
      type: 'steps',
      value: 1000 * n,
      unit: 'count',
      start: '2026-06-01T08:00:00.000Z',
      end: '2026-06-01T09:00:00.000Z',
      sourceLocalId: 'phone',
      sourceKind: 'phone',
      timeZone: 'UTC',
    }));
    expect(toDaily(samples, 'sum')).toEqual([{ day: '2026-06-01', value: 6000 }]);
  });
});
