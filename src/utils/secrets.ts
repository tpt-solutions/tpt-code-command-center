// API keys live in VS Code's SecretStorage (the OS keychain), not in settings.json. settings.json
// is read by every tool in the workspace and is often committed; the keychain is not.
//
// getConfig() is synchronous, so the keys are loaded into a cache at activation and read from
// there. This module has no vscode import: the store and the settings are passed in, so the
// logic can be tested directly.

export const API_KEY_SETTINGS = [
  'openrouterApiKey',
  'anthropicApiKey',
  'openaiApiKey',
  'deepseekApiKey',
  'qwenApiKey',
  'kimiApiKey',
  'grokApiKey',
  'glmApiKey',
  'mimoApiKey',
  'mistralApiKey',
  'groqApiKey',
  'geminiApiKey',
  'customApiKey',
] as const;

export type ApiKeySetting = typeof API_KEY_SETTINGS[number];

export interface SecretStoreLike {
  get(key: string): PromiseLike<string | undefined>;
  store(key: string, value: string): PromiseLike<void>;
  delete(key: string): PromiseLike<void>;
}

export interface SettingsLike {
  // The value in each scope, as the settings file holds it
  read(name: ApiKeySetting): { workspace?: string; global?: string };
  remove(name: ApiKeySetting): Promise<void>;
}

const SECRET_PREFIX = 'tpt.apiKey.';
const cache = new Map<ApiKeySetting, string>();

// Reads every key from the store into the cache. Call once, at activation, before getConfig().
export async function loadKeys(store: SecretStoreLike): Promise<void> {
  cache.clear();
  for (const name of API_KEY_SETTINGS) {
    const value = await store.get(SECRET_PREFIX + name);
    if (value) cache.set(name, value);
  }
}

export function cachedKey(name: ApiKeySetting): string | undefined {
  return cache.get(name);
}

// An empty value removes the key.
export async function storeKey(store: SecretStoreLike, name: ApiKeySetting, value: string): Promise<void> {
  const trimmed = value.trim();
  if (trimmed) {
    await store.store(SECRET_PREFIX + name, trimmed);
    cache.set(name, trimmed);
  } else {
    await store.delete(SECRET_PREFIX + name);
    cache.delete(name);
  }
}

export async function clearKeys(store: SecretStoreLike): Promise<void> {
  for (const name of API_KEY_SETTINGS) {
    await store.delete(SECRET_PREFIX + name);
  }
  cache.clear();
}

// Moves keys still held in settings.json into the secret store, then removes them from settings.
// If the store already has a key for that setting, the store's value is kept and the settings
// copy is still removed, so no plaintext key survives the migration. Returns the names moved.
export async function migrateKeysFromSettings(store: SecretStoreLike, settings: SettingsLike): Promise<ApiKeySetting[]> {
  const moved: ApiKeySetting[] = [];
  for (const name of API_KEY_SETTINGS) {
    const { workspace, global } = settings.read(name);
    const value = (workspace || global || '').trim();
    if (!value) continue;
    if (!cache.has(name)) {
      await storeKey(store, name, value);
    }
    await settings.remove(name);
    moved.push(name);
  }
  return moved;
}
