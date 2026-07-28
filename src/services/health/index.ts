/**
 * Platform selection happens here and nowhere else.
 *
 * Metro resolves the `.ios` / `.android` suffixed adapters at bundle time, so
 * neither native module is ever loaded on the wrong platform. On web (the
 * design preview target) we fall back to a null adapter that reports
 * `unsupported` — the app must remain fully usable without any health source
 * (spec, Android §12 acceptance criteria).
 */

import { Platform } from 'react-native';
import type {
  HealthAdapter, FeatureScope, Availability, AuthorizationResult, SourceInfo,
} from './HealthAdapter';
import type { HealthMetricSample, NormalizedSignal, SignalType } from '../../domain/models';

class NullHealthAdapter implements HealthAdapter {
  readonly platformName = 'No health source';
  async availability(): Promise<Availability> {
    return { state: 'unsupported', reason: 'This build has no health integration.' };
  }
  async openPlatformSettings() {}
  async requestAuthorization(scope: FeatureScope): Promise<AuthorizationResult> {
    return { granted: [], denied: [], undetermined: [] };
  }
  async authorizationStatus(): Promise<AuthorizationResult> {
    return { granted: [], denied: [], undetermined: [] };
  }
  async readSamples(): Promise<HealthMetricSample[]> { return []; }
  async readSignals(): Promise<NormalizedSignal[]> { return []; }
  async listSources(): Promise<SourceInfo[]> { return []; }
  async syncToken() { return null; }
  async setSyncToken() {}
}

let instance: HealthAdapter | null = null;

export function healthAdapter(): HealthAdapter {
  if (instance) return instance;
  if (Platform.OS === 'ios') {
    const { HealthKitAdapter } = require('./HealthKitAdapter.ios');
    instance = new HealthKitAdapter();
  } else if (Platform.OS === 'android') {
    const { HealthConnectAdapter } = require('./HealthConnectAdapter.android');
    instance = new HealthConnectAdapter();
  } else {
    instance = new NullHealthAdapter();
  }
  return instance!;
}

/** User-facing name for the platform's health store, used throughout the UI. */
export function healthSourceName(): string {
  return Platform.OS === 'ios' ? 'Apple Health' : Platform.OS === 'android' ? 'Health Connect' : 'Health data';
}

export * from './HealthAdapter';
export type { SignalType };
