/**
 * Non-health preferences (spec §7 `UserSettings`).
 * Nothing in this store is sensitive, so it persists to plain kv storage.
 * Health values, notes and credentials never appear here.
 */
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import type { AccentName, DarkStyle, ThemeMode } from '../design-system/tokens';
import type { WellnessCategory } from '../domain/models';
import { DEFAULT_BRIEFS, type BriefSchedule } from '../services/notifications/dailyBriefs';
import { DEFAULT_REMINDER_POLICY } from '../services/notifications/medicationScheduler';
import type { ReminderPolicy } from '../domain/models';
import KV from 'expo-sqlite/kv-store';

interface SettingsState {
  onboardingComplete: boolean;
  firstName: string | null;

  themeMode: ThemeMode;
  accent: AccentName;
  darkStyle: DarkStyle;
  locale: string;

  model: string;
  cloudEnabled: boolean;
  /** When true the provider must never substitute a different model (§18.1). */
  noFallback: boolean;

  briefsEnabled: boolean;
  briefs: BriefSchedule[];
  reminderPolicy: ReminderPolicy;

  analyticsConsent: boolean;
  auditTraceDataset: string | null;
  enabledRecommendationCategories: WellnessCategory[];

  set: <K extends keyof SettingsState>(key: K, value: SettingsState[K]) => void;
  setBrief: (kind: BriefSchedule['kind'], patch: Partial<BriefSchedule>) => void;
  reset: () => void;
}

const INITIAL = {
  onboardingComplete: false,
  firstName: null,
  themeMode: 'system' as ThemeMode,
  accent: 'clay' as AccentName,
  darkStyle: 'elevated' as DarkStyle,
  locale: 'en',
  model: 'gpt-5.6-terra',
  cloudEnabled: false,
  noFallback: true,
  briefsEnabled: false,
  briefs: DEFAULT_BRIEFS,
  reminderPolicy: DEFAULT_REMINDER_POLICY,
  analyticsConsent: false,
  auditTraceDataset: null,
  enabledRecommendationCategories: ['sleep', 'activity', 'recovery'] as WellnessCategory[],
};

export const useSettings = create<SettingsState>()(
  persist(
    (set) => ({
      ...INITIAL,
      set: (key, value) => set({ [key]: value } as Partial<SettingsState>),
      setBrief: (kind, patch) =>
        set((s) => ({ briefs: s.briefs.map((b) => (b.kind === kind ? { ...b, ...patch } : b)) })),
      reset: () => set(INITIAL),
    }),
    {
      name: 'aidr.settings',
      storage: createJSONStorage(() => ({
        getItem: (k) => KV.getItem(k),
        setItem: (k, v) => KV.setItem(k, v),
        removeItem: (k) => KV.removeItem(k),
      })),
    },
  ),
);
