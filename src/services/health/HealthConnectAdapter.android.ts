/**
 * Android Health Connect adapter (spec, Google Health section §1–§7).
 *
 * Health Connect — not Google Fit — is the integration layer. Fit may still be a
 * *contributing source* inside Health Connect, which is exactly why source
 * resolution matters: the same walk can arrive from Fit, Fitbit, a Pixel Watch
 * and the phone's own sensor. Summing them would triple the step count.
 */

import {
  initialize,
  getSdkStatus,
  SdkAvailabilityStatus,
  requestPermission,
  getGrantedPermissions,
  readRecords,
  insertRecords,
  openHealthConnectSettings,
  openHealthConnectDataManagement,
  getChangesToken,
  getChanges,
  type Permission,
} from 'react-native-health-connect';
import type {
  HealthAdapter, FeatureScope, Availability, AuthorizationResult, SourceInfo,
} from './HealthAdapter';
import { SCOPE_SIGNALS, aggregationFor, dedupStrategy, resolveOverlapping } from './HealthAdapter';
import type { HealthMetricSample, NormalizedSignal, SignalType } from '../../domain/models';
import { toDaily, buildNormalizedSignal } from '../../domain/baselines/personalBaseline';
import { getItem, setItem } from '../persistence/kv';

type RecordType = string;

const RECORD: Partial<Record<SignalType, { type: RecordType; unit: string; field: string }>> = {
  steps: { type: 'Steps', unit: 'count', field: 'count' },
  distance: { type: 'Distance', unit: 'm', field: 'distance.inMeters' },
  activeEnergy: { type: 'ActiveCaloriesBurned', unit: 'kcal', field: 'energy.inKilocalories' },
  exerciseMinutes: { type: 'ExerciseSession', unit: 'min', field: 'duration' },
  floors: { type: 'FloorsClimbed', unit: 'count', field: 'floors' },
  restingHeartRate: { type: 'RestingHeartRate', unit: 'count/min', field: 'beatsPerMinute' },
  heartRate: { type: 'HeartRate', unit: 'count/min', field: 'samples' },
  hrv: { type: 'HeartRateVariabilityRmssd', unit: 'ms', field: 'heartRateVariabilityMillis' },
  respiratoryRate: { type: 'RespiratoryRate', unit: 'count/min', field: 'rate' },
  oxygenSaturation: { type: 'OxygenSaturation', unit: '%', field: 'percentage' },
  skinTemperature: { type: 'SkinTemperature', unit: 'degC', field: 'baseline.inCelsius' },
  sleepDuration: { type: 'SleepSession', unit: 'min', field: 'duration' },
  sleepSchedule: { type: 'SleepSession', unit: 'min', field: 'startTime' },
  glucose: { type: 'BloodGlucose', unit: 'mg/dL', field: 'level.inMilligramsPerDeciliter' },
  bloodPressureSystolic: { type: 'BloodPressure', unit: 'mmHg', field: 'systolic.inMillimetersOfMercury' },
  bloodPressureDiastolic: { type: 'BloodPressure', unit: 'mmHg', field: 'diastolic.inMillimetersOfMercury' },
  bodyTemperature: { type: 'BodyTemperature', unit: 'degC', field: 'temperature.inCelsius' },
  weight: { type: 'Weight', unit: 'kg', field: 'weight.inKilograms' },
  bodyFat: { type: 'BodyFat', unit: '%', field: 'percentage' },
  leanMass: { type: 'LeanBodyMass', unit: 'kg', field: 'mass.inKilograms' },
  bmr: { type: 'BasalMetabolicRate', unit: 'kcal', field: 'basalMetabolicRate.inKilocaloriesPerDay' },
  hydration: { type: 'Hydration', unit: 'mL', field: 'volume.inMilliliters' },
  nutritionEnergy: { type: 'Nutrition', unit: 'kcal', field: 'energy.inKilocalories' },
  cycleDay: { type: 'MenstruationPeriod', unit: 'day', field: 'startTime' },
};

const TOKEN_KEY = 'health.hc.changeToken';
const PLAY_URL =
  'market://details?id=com.google.android.apps.healthdata';

export class HealthConnectAdapter implements HealthAdapter {
  readonly platformName = 'Health Connect';
  private ready = false;

  private async ensureInit(): Promise<boolean> {
    if (this.ready) return true;
    this.ready = await initialize().catch(() => false);
    return this.ready;
  }

  async availability(): Promise<Availability> {
    const status = await getSdkStatus();
    if (status === SdkAvailabilityStatus.SDK_AVAILABLE) {
      await this.ensureInit();
      return { state: 'available' };
    }
    if (status === SdkAvailabilityStatus.SDK_UNAVAILABLE_PROVIDER_UPDATE_REQUIRED) {
      return { state: 'notInstalled', installURL: PLAY_URL };
    }
    return {
      state: 'unsupported',
      reason: 'Health Connect needs Android 9 or later. AIDr. still works with manual entries and documents.',
    };
  }

  async openPlatformSettings(): Promise<void> {
    await openHealthConnectSettings();
  }

  /** Deep-links to Android's own data-management screen (required by §3). */
  async openDataManagement(): Promise<void> {
    await openHealthConnectDataManagement();
  }

  private permissionsFor(scope: FeatureScope): Permission[] {
    const types = new Set(
      SCOPE_SIGNALS[scope].map((t) => RECORD[t]?.type).filter(Boolean) as string[],
    );
    const perms: Permission[] = [...types].map((recordType) => ({
      accessType: 'read',
      recordType: recordType as Permission['recordType'],
    }));

    // Write is requested only for user-initiated logging, and only in the two
    // modules the spec permits (§8 diet write-back, §7 confirmed dose).
    if (scope === 'nutrition') {
      perms.push(
        { accessType: 'write', recordType: 'Hydration' as Permission['recordType'] },
        { accessType: 'write', recordType: 'Nutrition' as Permission['recordType'] },
      );
    }
    return perms;
  }

  async requestAuthorization(scope: FeatureScope): Promise<AuthorizationResult> {
    if (!(await this.ensureInit())) {
      return { granted: [], denied: [], undetermined: SCOPE_SIGNALS[scope] };
    }
    await requestPermission(this.permissionsFor(scope));
    return this.authorizationStatus(scope);
  }

  async authorizationStatus(scope: FeatureScope): Promise<AuthorizationResult> {
    if (!(await this.ensureInit())) {
      return { granted: [], denied: [], undetermined: SCOPE_SIGNALS[scope] };
    }
    const grantedPerms = await getGrantedPermissions();
    const grantedTypes = new Set(
      grantedPerms.filter((p) => p.accessType === 'read').map((p) => p.recordType as string),
    );

    const granted: SignalType[] = [];
    const denied: SignalType[] = [];
    for (const t of SCOPE_SIGNALS[scope]) {
      const rec = RECORD[t];
      if (rec && grantedTypes.has(rec.type)) granted.push(t);
      else denied.push(t);
    }
    // A partial grant is a normal state, never an error (§3).
    return { granted, denied, undetermined: [] };
  }

  /** LOCAL ONLY. */
  async readSamples(type: SignalType, from: Date, to: Date): Promise<HealthMetricSample[]> {
    const rec = RECORD[type];
    if (!rec || !(await this.ensureInit())) return [];

    const { records } = await readRecords(rec.type as never, {
      timeRangeFilter: {
        operator: 'between',
        startTime: from.toISOString(),
        endTime: to.toISOString(),
      },
    });

    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    return (records as Array<Record<string, unknown>>)
      .map((r, i) => {
        const value = extractValue(r, type, rec.field);
        if (value == null || Number.isNaN(value)) return null;
        const start = (r.startTime ?? r.time) as string;
        const end = (r.endTime ?? r.time ?? start) as string;
        const origin = (r.metadata as { dataOrigin?: string } | undefined)?.dataOrigin ?? 'unknown';
        return {
          id: `${type}-${start}-${i}`,
          type,
          value,
          unit: rec.unit,
          start: new Date(start).toISOString(),
          end: new Date(end).toISOString(),
          sourceLocalId: origin,
          sourceKind: classifyOrigin(origin),
          timeZone: tz,
        } satisfies HealthMetricSample;
      })
      .filter(Boolean) as HealthMetricSample[];
  }

  async readSignals(scope: FeatureScope, days: number): Promise<NormalizedSignal[]> {
    const to = new Date();
    const from = new Date(to.getTime() - days * 86_400_000);
    const sources = await this.listSources();
    const out: NormalizedSignal[] = [];

    for (const type of SCOPE_SIGNALS[scope]) {
      const rec = RECORD[type];
      if (!rec) continue;
      const samples = await this.readSamples(type, from, to);
      if (samples.length === 0) continue;

      const deduped = resolveOverlapping(samples, sources, dedupStrategy(type));
      const daily = toDaily(deduped, aggregationFor(type));
      const signal = buildNormalizedSignal(type, rec.unit, daily, to);
      if (signal) out.push(signal);
    }
    return out;
  }

  async listSources(): Promise<SourceInfo[]> {
    const recent = await this.readSamples(
      'steps',
      new Date(Date.now() - 7 * 86_400_000),
      new Date(),
    );
    const seen = new Map<string, SourceInfo>();
    for (const s of recent) {
      if (seen.has(s.sourceLocalId)) continue;
      seen.set(s.sourceLocalId, {
        localId: s.sourceLocalId,
        displayName: friendlyOrigin(s.sourceLocalId),
        kind: s.sourceKind,
        lastSync: s.end,
        priority: s.sourceKind === 'watch' ? 0 : s.sourceKind === 'phone' ? 1 : 2,
      });
    }
    return [...seen.values()].sort((a, b) => a.priority - b.priority);
  }

  /** Hydration write-back after the user confirms a logged meal or drink. */
  async writeHydration(millilitres: number, at: Date): Promise<boolean> {
    if (!(await this.ensureInit())) return false;
    try {
      await insertRecords([
        {
          recordType: 'Hydration',
          startTime: at.toISOString(),
          endTime: at.toISOString(),
          volume: { value: millilitres, unit: 'milliliters' },
        } as never,
      ]);
      return true;
    } catch {
      return false;
    }
  }

  async syncToken() {
    return getItem(TOKEN_KEY);
  }
  async setSyncToken(token: string | null) {
    await setItem(TOKEN_KEY, token);
  }

  /** Incremental sync. Falls back to a full window read if the token expired. */
  async pullChanges(scope: FeatureScope): Promise<{ changed: boolean; token: string | null }> {
    if (!(await this.ensureInit())) return { changed: false, token: null };
    const existing = await this.syncToken();
    try {
      if (!existing) {
        const token = await getChangesToken(this.permissionsFor(scope));
        await this.setSyncToken(token);
        return { changed: true, token };
      }
      const res = await getChanges(existing);
      await this.setSyncToken(res.nextChangesToken);
      return { changed: (res.upsertionChanges?.length ?? 0) > 0, token: res.nextChangesToken };
    } catch {
      await this.setSyncToken(null);
      return { changed: true, token: null };
    }
  }
}

function extractValue(
  record: Record<string, unknown>,
  type: SignalType,
  path: string,
): number | null {
  if (type === 'sleepDuration' || type === 'exerciseMinutes') {
    const start = new Date(record.startTime as string).getTime();
    const end = new Date(record.endTime as string).getTime();
    return (end - start) / 60_000;
  }
  if (type === 'heartRate') {
    const samples = record.samples as Array<{ beatsPerMinute: number }> | undefined;
    if (!samples?.length) return null;
    return samples.reduce((a, s) => a + s.beatsPerMinute, 0) / samples.length;
  }
  const value = path.split('.').reduce<unknown>((acc, key) => {
    if (acc && typeof acc === 'object') return (acc as Record<string, unknown>)[key];
    return undefined;
  }, record);
  return typeof value === 'number' ? value : null;
}

function classifyOrigin(origin: string): HealthMetricSample['sourceKind'] {
  if (/fitbit|wearables|pixelwatch|galaxywatch|wear/i.test(origin)) return 'watch';
  if (/healthdata|android\.gms|devicehealth/i.test(origin)) return 'phone';
  if (/manual|input/i.test(origin)) return 'manual';
  return 'thirdParty';
}

function friendlyOrigin(origin: string): string {
  if (/fitbit/i.test(origin)) return 'Fitbit';
  if (/pixelwatch|wear/i.test(origin)) return 'Pixel Watch';
  if (/samsung|shealth/i.test(origin)) return 'Samsung Health';
  if (/google.*fit/i.test(origin)) return 'Google Fit';
  if (/healthdata/i.test(origin)) return 'Health Connect';
  return origin.split('.').slice(-1)[0] || 'Other app';
}
