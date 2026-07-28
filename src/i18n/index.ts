/**
 * Localisation (spec §15).
 *
 * Target languages: English, French, German, Hindi, Simplified Chinese, Spanish.
 * Two rules specific to a health app:
 *
 *   1. Safety strings are translated by a human reviewer, never machine-only. A
 *      mistranslated emergency instruction is a safety defect, so `safety.*` keys
 *      live in their own namespace and ship with a `reviewedBy` marker.
 *   2. The prompt tells the model to answer in the user's locale, so output
 *      language follows the UI without a second translation pass.
 *
 * RTL is wired but not released — `I18nManager.allowRTL(true)` is enabled so
 * layouts can be verified in review before any RTL locale ships.
 */

import { I18n } from 'i18n-js';
import { getLocales } from 'expo-localization';
import { I18nManager } from 'react-native';

import en from './locales/en';

export const SUPPORTED = ['en', 'fr', 'de', 'hi', 'zh-Hans', 'es'] as const;
export type Supported = (typeof SUPPORTED)[number];

export const i18n = new I18n({ en });

// Lazily register the rest so a cold start only parses the active locale.
const LOADERS: Record<Exclude<Supported, 'en'>, () => Promise<{ default: object }>> = {
  fr: () => import('./locales/fr'),
  de: () => import('./locales/de'),
  hi: () => import('./locales/hi'),
  'zh-Hans': () => import('./locales/zh-Hans'),
  es: () => import('./locales/es'),
};

i18n.defaultLocale = 'en';
i18n.enableFallback = true;

export async function initLocale(preferred?: string): Promise<Supported> {
  const device = getLocales()[0]?.languageTag ?? 'en';
  const resolved = resolve(preferred ?? device);

  if (resolved !== 'en' && !i18n.translations[resolved]) {
    const mod = await LOADERS[resolved]();
    i18n.store({ [resolved]: mod.default });
  }
  i18n.locale = resolved;
  I18nManager.allowRTL(true);
  return resolved;
}

function resolve(tag: string): Supported {
  const lower = tag.toLowerCase();
  if (lower.startsWith('zh')) return 'zh-Hans';
  const base = lower.split('-')[0];
  return (SUPPORTED.find((s) => s.toLowerCase().split('-')[0] === base) ?? 'en') as Supported;
}

export const t = (key: string, options?: Record<string, unknown>) => i18n.t(key, options);
