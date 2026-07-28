/**
 * iOS HealthKit adapter (spec §8).
 *
 * Read-only by default. The only write authorisation we ever request is a
 * medication dose event, and only when the user enables the medication module —
 * §26.2 requires a deliberate user action for every write.
 */

import Healthkit, {
  HKQuantityTypeIdentifier,
  HKCategoryTypeIdentifier,
  HKStatisticsOptions,
  HKUnits,
} from '@kingstinct/react-native-healthkit';
import type {
  HealthAdapter, FeatureScope, Availability, AuthorizationResult, SourceInfo,
} from './HealthAdapter';
import { SCOPE_SIGNALS, aggregationFor, dedupStrategy, resolveOverlapping } from './HealthAdapter';
import type { HealthMetricSample, NormalizedSignal, SignalType } from '../../domain/models';
import { toDaily, buildNormalizedSignal } from '../../domain/baselines/personalBaseline';
import { getItem, setItem } from '../persistence/kv';

const QUANTITY: Partial<Record<SignalType, { id: HKQuantityTypeIdentifier; unit: string }>> = {
  steps: { id: HKQuantityTypeIdentifier.stepCount, unit: 'count' },
  distance: { id: HKQuantityTypeIdentifier.distanceWalkingRunning, unit: 'm' },
  activeEnergy: { id: HKQuantityTypeIdentifier.activeEnergyBurned, unit: 'kcal' },
  exerciseMinutes: { id: HKQuantityTypeIdentifier.appleExerciseTime, unit: 'min' },
  floors: { id: HKQuantityTypeIdentifier.flightsClimbed, unit: 'count' },
  restingHeartRate: { id: HKQuantityTypeIdentifier.restingHeartRate, unit: 'count/min' },
  heartRate: { id: HKQuantityTypeIdentifier.heartRate, unit: 'count/min' },
  walkingHeartRate: { id: HKQuantityTypeIdentifier.walkingHeartRateAverage, unit: 'count/min' },
  hrv: { id: HKQuantityTypeIdentifier.heartRateVariabilitySDNN, unit: 'ms' },
  vo2max: { id: HKQuantityTypeIdentifier.vo2Max, unit: 'ml/(kg*min)' },
  respiratoryRate: { id: HKQuantityTypeIdentifier.respiratoryRate, unit: 'count/min' },
  oxygenSaturation: { id: HKQuantityTypeIdentifier.oxygenSaturation, unit: '%' },
  walkingSpeed: { id: HKQuantityTypeIdentifier.walkingSpeed, unit: 'm/s' },
  stepLength: { id: HKQuantityTypeIdentifier.walkingStepLength, unit: 'cm' },
  glucose: { id: HKQuantityTypeIdentifier.bloodGlucose, unit: 'mg/dL' },
  bloodPressureSystolic: { id: HKQuantityTypeIdentifier.bloodPressureSystolic, unit: 'mmHg' },
  bloodPressureDiastolic: { id: HKQuantityTypeIdentifier.bloodPressureDiastolic, unit: 'mmHg' },
  bodyTemperature: { id: HKQuantityTypeIdentifier.bodyTemperature, unit: 'degC' },
  weight: { id: HKQuantityTypeIdentifier.bodyMass, unit: 'kg' },
  bodyFat: { id: HKQuantityTypeIdentifier.bodyFatPercentage, unit: '%' },
  leanMass: { id: HKQuantityTypeIdentifier.leanBodyMass, unit: 'kg' },
  bmr: { id: HKQuantityTypeIdentifier.basalEnergyBurned, unit: 'kcal' },
  hydration: { id: HKQuantityTypeIdentifier.dietaryWater, unit: 'mL' },
  nutritionEnergy: { id: HKQuantityTypeIdentifier.dietaryEnergyConsumed, unit: 'kcal' },
};

const CATEGORY: Partial<Record<SignalType, HKCategoryTypeIdentifier>> = {
  sleepDuration: HKCategoryTypeIdentifier.sleepAnalysis,
  sleepSchedule: HKCategoryTypeIdentifier.sleepAnalysis,
  cycleDay: HKCategoryTypeIdentifier.menstrualFlow,
};

const ANCHOR_KEY = 'health.hk.anchor';

export class HealthKitAdapter implements HealthAdapter {
  readonly platformName = 'Apple Health';

  async availability(): Promise<Availability> {
    const ok = await Healthkit.isHealthDataAvailable();
    return ok
      ? { state: 'available' }
      : { state: 'unsupported', reason: 'Apple Health is not available on this device.' };
  }

  async openPlatformSettings(): Promise<void> {
    // HealthKit permissions live in Settings › Health › Data Access & Devices.
    const { Linking } = await import('react-native');
    await Linking.openURL('x-apple-health://');
  }

  private identifiersFor(scope: FeatureScope) {
    const types = SCOPE_SIGNALS[scope];
    return {
      quantities: types.map((t) => QUANTITY[t]?.id).filter(Boolean) as HKQuantityTypeIdentifier[],
      categories: types.map((t) => CATEGORY[t]).filter(Boolean) as HKCategoryTypeIdentifier[],
      types,
    };
  }

  async requestAuthorization(scope: FeatureScope): Promise<AuthorizationResult> {
    const { quantities, categories } = this.identifiersFor(scope);
    // Medication is the only scope that ever asks for a share (write) type.
    const share = scope === 'medication' ? ([] as HKQuantityTypeIdentifier[]) : [];
    await Healthkit.requestAuthorization([...quantities, ...categories], share);
    return this.authorizationStatus(scope);
  }

  /**
   * HealthKit deliberately does not reveal read denials — `sharingDenied` for a
   * read type is indistinguishable from "never asked". We therefore probe with a
   * one-sample query and treat an empty-but-authorised result as granted.
   */
  async authorizationStatus(scope: FeatureScope): Promise<AuthorizationResult> {
    const { types } = this.identifiersFor(scope);
    const granted: SignalType[] = [];
    const undetermined: SignalType[] = [];

    for (const t of types) {
      const q = QUANTITY[t];
      if (!q) {
        undetermined.push(t);
        continue;
      }
      try {
        await Healthkit.queryQuantitySamples(q.id, { limit: 1 });
        granted.push(t);
      } catch {
        undetermined.push(t);
      }
    }
    return { granted, denied: [], undetermined };
  }

  /** LOCAL ONLY. */
  async readSamples(type: SignalType, from: Date, to: Date): Promise<HealthMetricSample[]> {
    const q = QUANTITY[type];
    if (!q) return [];
    const raw = await Healthkit.queryQuantitySamples(q.id, {
      from,
      to,
      unit: q.unit as unknown as HKUnits,
    });
    return raw.map((s, i) => ({
      id: `${type}-${s.startDate}-${i}`,
      type,
      value: s.quantity,
      unit: q.unit,
      start: new Date(s.startDate).toISOString(),
      end: new Date(s.endDate).toISOString(),
      // Bundle id only. The human-readable device name stays out of the model. 
      sourceLocalId: s.sourceRevision?.source?.bundleIdentifier ?? 'unknown',
      sourceKind: classifySource(s.sourceRevision?.source?.bundleIdentifier),
      timeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
    }));
  }

  async readSignals(scope: FeatureScope, days: number): Promise<NormalizedSignal[]> {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const sources = await this.listSources();
    const out: NormalizedSignal[] = [];

    for (const type of SCOPE_SIGNALS[scope]) {
      const q = QUANTITY[type];
      if (!q) continue;
      const samples = await this.readSamples(type, from, to);
      if (samples.length === 0) continue;

      const deduped = resolveOverlapping(samples, sources, dedupStrategy(type));
      const daily = toDaily(deduped, aggregationFor(type));
      const signal = buildNormalizedSignal(type, q.unit, daily, to);
      if (signal) out.push(signal);
    }
    return out;
  }

  async listSources(): Promise<SourceInfo[]> {
    // HealthKit exposes sources per sample; we derive the set from recent steps
    // and let the user reorder priority in Settings › Connected sources.
    const recent = await this.readSamples(
      'steps',
      new Date(Date.now() - 7 * 86_400_000),
      new Date(),
    );
    const seen = new Map<string, SourceInfo>();
    recent.forEach((s) => {
      if (seen.has(s.sourceLocalId)) return;
      seen.set(s.sourceLocalId, {
        localId: s.sourceLocalId,
        displayName: friendlyName(s.sourceLocalId),
        kind: s.sourceKind,
        lastSync: s.end,
        priority: s.sourceKind === 'watch' ? 0 : s.sourceKind === 'phone' ? 1 : 2,
      });
    });
    return [...seen.values()].sort((a, b) => a.priority - b.priority);
  }

  async syncToken() {
    return getItem(ANCHOR_KEY);
  }
  async setSyncToken(token: string | null) {
    await setItem(ANCHOR_KEY, token);
  }
}

function classifySource(bundle?: string): HealthMetricSample['sourceKind'] {
  if (!bundle) return 'manual';
  if (bundle.includes('apple.health') || bundle.includes('NanoHealth')) return 'watch';
  if (bundle.startsWith('com.apple')) return 'phone';
  return 'thirdParty';
}

function friendlyName(bundle: string): string {
  if (bundle.includes('NanoHealth') || bundle.includes('apple.health')) return 'Apple Watch';
  if (bundle.startsWith('com.apple')) return 'iPhone';
  return bundle.split('.').slice(-1)[0] || 'Other app';
}
