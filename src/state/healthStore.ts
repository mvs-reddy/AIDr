/**
 * Health connection state, observable from Home, every workflow and Settings
 * (spec §22 "Health connection state observable across surfaces").
 *
 * Holds normalized signals only. Raw samples are never lifted into app state —
 * they are read, aggregated and discarded inside the adapter.
 */
import { create } from 'zustand';
import type { NormalizedSignal } from '../domain/models';
import { healthAdapter, healthSourceName, type FeatureScope, type Availability, type SourceInfo } from '../services/health';

type ConnectionState = 'unknown' | 'unavailable' | 'notConnected' | 'partial' | 'connected';

interface HealthState {
  sourceName: string;
  availability: Availability | null;
  connection: ConnectionState;
  signals: Record<string, NormalizedSignal>;
  sources: SourceInfo[];
  grantedScopes: FeatureScope[];
  lastSync: string | null;
  syncing: boolean;

  bootstrap: () => Promise<void>;
  connect: (scope: FeatureScope) => Promise<boolean>;
  refresh: (scope: FeatureScope, days?: number) => Promise<void>;
  signalsFor: (scope: FeatureScope) => NormalizedSignal[];
}

export const useHealth = create<HealthState>((set, get) => ({
  sourceName: healthSourceName(),
  availability: null,
  connection: 'unknown',
  signals: {},
  sources: [],
  grantedScopes: [],
  lastSync: null,
  syncing: false,

  bootstrap: async () => {
    const adapter = healthAdapter();
    const availability = await adapter.availability();
    if (availability.state !== 'available') {
      set({ availability, connection: 'unavailable' });
      return;
    }
    const status = await adapter.authorizationStatus('dailyReads');
    set({
      availability,
      connection:
        status.granted.length === 0 ? 'notConnected'
        : status.denied.length > 0 ? 'partial'
        : 'connected',
    });
  },

  connect: async (scope) => {
    const adapter = healthAdapter();
    const result = await adapter.requestAuthorization(scope);
    // A partial grant is success, not failure (§8.1).
    const ok = result.granted.length > 0;
    if (ok) {
      set((s) => ({
        grantedScopes: [...new Set([...s.grantedScopes, scope])],
        connection: result.denied.length > 0 ? 'partial' : 'connected',
      }));
      await get().refresh(scope);
    }
    return ok;
  },

  refresh: async (scope, days = 90) => {
    set({ syncing: true });
    try {
      const adapter = healthAdapter();
      const [signals, sources] = await Promise.all([
        adapter.readSignals(scope, days),
        adapter.listSources(),
      ]);
      set((s) => ({
        signals: { ...s.signals, ...Object.fromEntries(signals.map((x) => [x.type, x])) },
        sources,
        lastSync: new Date().toISOString(),
      }));
    } finally {
      set({ syncing: false });
    }
  },

  signalsFor: (scope) => {
    const { SCOPE_SIGNALS } = require('../services/health/HealthAdapter');
    const wanted: string[] = SCOPE_SIGNALS[scope];
    const all = get().signals;
    return wanted.map((t) => all[t]).filter(Boolean);
  },
}));
