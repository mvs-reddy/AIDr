/**
 * Non-sensitive key/value storage (sync anchors, feature flags, last-seen).
 * Health values and free text never go here — those live in the encrypted
 * SQLite store with file protection.
 */
import AsyncStorageLike from 'expo-sqlite/kv-store';

export async function getItem(key: string): Promise<string | null> {
  return AsyncStorageLike.getItem(key);
}
export async function setItem(key: string, value: string | null): Promise<void> {
  if (value === null) await AsyncStorageLike.removeItem(key);
  else await AsyncStorageLike.setItem(key, value);
}
export async function getJSON<T>(key: string, fallback: T): Promise<T> {
  const raw = await getItem(key);
  if (!raw) return fallback;
  try { return JSON.parse(raw) as T; } catch { return fallback; }
}
export async function setJSON(key: string, value: unknown): Promise<void> {
  await setItem(key, JSON.stringify(value));
}
