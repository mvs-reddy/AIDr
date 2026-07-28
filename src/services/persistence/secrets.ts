/**
 * Credential storage (spec §9.3).
 *
 * Keychain on iOS / Keystore-backed EncryptedSharedPreferences on Android.
 * `requireAuthentication` is deliberately false: a Face ID prompt in the middle
 * of a background daily-read refresh would fail silently and look like a bug.
 * Instead we set the strictest *at-rest* class and never sync to iCloud, so a
 * restored backup on a new device does not carry the key (§9.3).
 */
import * as SecureStore from 'expo-secure-store';

export type SecretKey =
  | 'ai.openai.key'
  | 'ai.openai.sessionToken'
  | 'audit.huggingface.token'
  | 'share.signingKey';

const OPTIONS: SecureStore.SecureStoreOptions = {
  keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
};

export async function getSecret(key: SecretKey): Promise<string | null> {
  try { return await SecureStore.getItemAsync(key, OPTIONS); } catch { return null; }
}
export async function setSecret(key: SecretKey, value: string): Promise<void> {
  await SecureStore.setItemAsync(key, value, OPTIONS);
}
export async function deleteSecret(key: SecretKey): Promise<void> {
  await SecureStore.deleteItemAsync(key, OPTIONS);
}
/** Used by Settings › Delete all local data. */
export async function purgeAllSecrets(): Promise<void> {
  const keys: SecretKey[] = [
    'ai.openai.key', 'ai.openai.sessionToken', 'audit.huggingface.token', 'share.signingKey',
  ];
  await Promise.all(keys.map(deleteSecret));
}
/** Never log the value. Masked form for the Settings row only. */
export function maskSecret(value: string | null): string {
  if (!value) return 'Not set';
  return `••••••••${value.slice(-4)}`;
}
