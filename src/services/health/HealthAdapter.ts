/**
 * The cross-platform health contract.
 *
 * Feature code never imports HealthKit or Health Connect directly — it asks for
 * a *feature scope* and receives normalized signals. That keeps two rules
 * enforceable in one place:
 *
 *   1. Just-in-time, minimum-scope permissions (spec §8.1, Android §3). We ask
 *      for the record types a feature needs at the moment the user enables it,
 *      never a blanket grant at launch.
 *   2. Raw samples never escape. `readSignals()` returns NormalizedSignal only;
 *      `readSamples()` is intentionally marked local-only and is unreachable
 *      from the AI context builder.
 */

import type { NormalizedSignal, HealthMetricSample, SignalType } from '../../domain/models';

/** Groups map 1:1 to a user-visible feature, so consent copy can be specific. */
export type FeatureScope =
  | 'dailyReads' | 'visitPrep' | 'sleepRecovery' | 'activity' | 'body'
  | 'metabolic' | 'medication' | 'nutrition' | 'cycle';

export const SCOPE_SIGNALS: Record<FeatureScope, SignalType[]> = {
  dailyReads: ['steps', 'activeEnergy', 'restingHeartRate', 'sleepDuration'],
  visitPrep: ['steps', 'restingHeartRate', 'sleepDuration', 'weight', 'bloodPressureSystolic', 'bloodPressureDiastolic'],
  sleepRecovery: ['sleepDuration', 'sleepSchedule', 'restingHeartRate', 'hrv', 'respiratoryRate', 'oxygenSaturation', 'skinTemperature'],
  activity: ['steps', 'distance', 'activeEnergy', 'exerciseMinutes', 'floors', 'walkingSpeed', 'stepLength'],
  body: ['weight', 'bodyFat', 'leanMass', 'bmr'],
  metabolic: ['glucose', 'bloodPressureSystolic', 'bloodPressureDiastolic', 'bodyTemperature'],
  medication: [],
  nutrition: ['hydration', 'nutritionEnergy'],
  cycle: ['cycleDay'],
};

export type Availability =
  | { state: 'available' }
  | { state: 'notInstalled'; installURL?: string }
  | { state: 'unsupported'; reason: string };

export interface AuthorizationResult {
  /** Types the user actually granted. A partial grant is a success, not an error. */
  granted: SignalType[];
  denied: SignalType[];
  /** Platforms hide prior denials; treat `undetermined` as "may ask again". */
  undetermined: SignalType[];
}

export interface SourceInfo {
  localId: string;
  displayName: string;
  kind: 'watch' | 'phone' | 'thirdParty' | 'manual' | 'clinical';
  lastSync: string | null;
  priority: number;
}

export interface HealthAdapter {
  readonly platformName: string;
  availability(): Promise<Availability>;
  /** Opens the OS installer / settings when the platform store is missing. */
  openPlatformSettings(): Promise<void>;

  /** Ask only for `scope`. Must be called from a user gesture. */
  requestAuthorization(scope: FeatureScope): Promise<AuthorizationResult>;
  authorizationStatus(scope: FeatureScope): Promise<AuthorizationResult>;

  /** LOCAL ONLY. Never reachable from the AI context builder. */
  readSamples(type: SignalType, from: Date, to: Date): Promise<HealthMetricSample[]>;

  /** The cloud-safe path: aggregate + baseline, computed on device. */
  readSignals(scope: FeatureScope, days: number): Promise<NormalizedSignal[]>;

  listSources(): Promise<SourceInfo[]>;

  /** The single write path in the app: a dose the user confirmed. Never automatic. */
  writeDoseEvent?(input: {
    medicationName: string;
    takenAt: Date;
    quantity?: string;
  }): Promise<boolean>;

  /** Incremental sync handle. HealthKit anchors / Health Connect change tokens. */
  syncToken(): Promise<string | null>;
  setSyncToken(token: string | null): Promise<void>;
}

/**
 * Source-aware aggregation (Android §6). Health Connect commonly holds the same
 * walk written by a phone, a watch and a third-party app. Summing them triples
 * the step count, so for interval-style signals we take the highest-priority
 * source that covers the window rather than adding sources together.
 */
export function resolveOverlapping(
  samples: HealthMetricSample[],
  sources: SourceInfo[],
  strategy: 'highestPriority' | 'keepAll',
): HealthMetricSample[] {
  if (strategy === 'keepAll') return samples;

  const priority = new Map(sources.map((s) => [s.localId, s.priority]));
  const byDay = new Map<string, HealthMetricSample[]>();
  for (const s of samples) {
    const day = s.start.slice(0, 10);
    byDay.set(day, [...(byDay.get(day) ?? []), s]);
  }

  const out: HealthMetricSample[] = [];
  for (const daySamples of byDay.values()) {
    const best = daySamples.reduce<string | null>((acc, s) => {
      const p = priority.get(s.sourceLocalId) ?? 99;
      const accP = acc ? (priority.get(acc) ?? 99) : Infinity;
      return p < accP ? s.sourceLocalId : acc;
    }, null);
    out.push(...daySamples.filter((s) => s.sourceLocalId === best));
  }
  return out;
}

/**
 * Which signals may be summed across sources and which must be kept per-record.
 * Clinical observations (BP, glucose) are never merged — each reading is a fact
 * with its own timestamp and source.
 */
export function aggregationFor(type: SignalType): 'sum' | 'mean' | 'min' | 'max' {
  switch (type) {
    case 'steps':
    case 'distance':
    case 'activeEnergy':
    case 'exerciseMinutes':
    case 'floors':
    case 'sleepDuration':
    case 'hydration':
    case 'nutritionEnergy':
      return 'sum';
    case 'restingHeartRate':
      return 'min';
    default:
      return 'mean';
  }
}

export function dedupStrategy(type: SignalType): 'highestPriority' | 'keepAll' {
  return ['bloodPressureSystolic', 'bloodPressureDiastolic', 'glucose', 'bodyTemperature', 'weight'].includes(type)
    ? 'keepAll'
    : 'highestPriority';
}
