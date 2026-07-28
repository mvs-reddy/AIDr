/**
 * Named-entity backends for redaction.
 *
 * Tier 1 `clinicalPack` — a downloadable on-device model (~40 MB) specialised for
 *   clinical PII/PHI. Shipped as Core ML on iOS and TFLite on Android, invoked
 *   through a small native module. Optional: the onboarding privacy step offers
 *   it, and Settings shows a Ready / Not installed state.
 * Tier 2 `platform`  — Apple `NLTagger` (nameType) / Android ML Kit entity
 *   extraction. Always available, lower recall on clinical text.
 * Tier 3 `null`      — patterns only.
 *
 * The chosen tier is surfaced verbatim in the privacy log so the user can see
 * which engine protected a given run.
 */

import { NativeModules, Platform } from 'react-native';
import type { EntityClass } from './RedactionService';

export interface DetectedEntity {
  start: number;
  end: number;
  text: string;
  entity: EntityClass;
  confidence: number;
}

export interface NERBackend {
  kind: 'clinicalPack' | 'platform';
  name: string;
  detect(text: string): Promise<DetectedEntity[]>;
}

interface AIDrRedactionNativeModule {
  isPackInstalled(): Promise<boolean>;
  packSizeBytes(): Promise<number>;
  downloadPack(): Promise<boolean>;
  removePack(): Promise<boolean>;
  detectClinical(text: string): Promise<DetectedEntity[]>;
  detectPlatform(text: string): Promise<DetectedEntity[]>;
}

const Native = (NativeModules as Record<string, unknown>).AIDrRedaction as
  | AIDrRedactionNativeModule
  | undefined;

let cached: NERBackend | null | undefined;

export async function getNERBackend(): Promise<NERBackend | null> {
  if (cached !== undefined) return cached;

  if (!Native) {
    // Expo Go / web preview: patterns only. Never silently claim stronger cover.
    cached = null;
    return cached;
  }

  try {
    if (await Native.isPackInstalled()) {
      cached = {
        kind: 'clinicalPack',
        name: Platform.OS === 'ios' ? 'clinical-pii.mlmodelc' : 'clinical-pii.tflite',
        detect: (t) => Native.detectClinical(t),
      };
      return cached;
    }
  } catch {
    // fall through to platform tier
  }

  cached = {
    kind: 'platform',
    name: Platform.OS === 'ios' ? 'NLTagger.nameType' : 'MLKit.EntityExtraction',
    detect: (t) => Native.detectPlatform(t).catch(() => []),
  };
  return cached;
}

export const redactionPack = {
  async status(): Promise<{ available: boolean; installed: boolean; sizeBytes: number }> {
    if (!Native) return { available: false, installed: false, sizeBytes: 0 };
    const installed = await Native.isPackInstalled().catch(() => false);
    const sizeBytes = await Native.packSizeBytes().catch(() => 0);
    return { available: true, installed, sizeBytes };
  },
  async install(): Promise<boolean> {
    if (!Native) return false;
    const ok = await Native.downloadPack().catch(() => false);
    cached = undefined; // force re-resolve so the tier upgrades immediately
    return ok;
  },
  async remove(): Promise<boolean> {
    if (!Native) return false;
    const ok = await Native.removePack().catch(() => false);
    cached = undefined;
    return ok;
  },
};
