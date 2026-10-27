import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  API_KEY_SETTINGS,
  ApiKeySetting,
  SecretStoreLike,
  SettingsLike,
  cachedKey,
  clearKeys,
  loadKeys,
  migrateKeysFromSettings,
  storeKey,
} from '../utils/secrets';
import { getConfig } from '../utils/config';

function fakeStore(initial: Record<string, string> = {}): SecretStoreLike & { data: Record<string, string> } {
  const data = { ...initial };
  return {
    data,
    get: async (key) => data[key],
    store: async (key, value) => { data[key] = value; },
    delete: async (key) => { delete data[key]; },
  };
}

// Settings view with the given values per scope; removals are recorded
function fakeSettings(values: Partial<Record<ApiKeySetting, { workspace?: string; global?: string }>>): SettingsLike & { removed: string[] } {
  const removed: string[] = [];
  return {
    removed,
    read: (name) => values[name] ?? {},
    remove: async (name) => {
      removed.push(name);
      delete values[name];
    },
  };
}

test('secrets: keys load from the store into the cache', async () => {
  await loadKeys(fakeStore({ 'tpt.apiKey.openrouterApiKey': 'or-123' }));
  assert.equal(cachedKey('openrouterApiKey'), 'or-123');
  assert.equal(cachedKey('anthropicApiKey'), undefined);
});

test('secrets: storing a key updates the store and the cache; an empty value removes it', async () => {
  const store = fakeStore();
  await loadKeys(store);

  await storeKey(store, 'groqApiKey', '  gsk-test  ');
  assert.equal(store.data['tpt.apiKey.groqApiKey'], 'gsk-test', 'trimmed before storing');
  assert.equal(cachedKey('groqApiKey'), 'gsk-test');

  await storeKey(store, 'groqApiKey', '');
  assert.equal('tpt.apiKey.groqApiKey' in store.data, false);
  assert.equal(cachedKey('groqApiKey'), undefined);
});

test('secrets: migration moves a plaintext key out of settings and into the store', async () => {
  const store = fakeStore();
  await loadKeys(store);
  const settings = fakeSettings({ anthropicApiKey: { workspace: 'sk-ant-old' } });

  const moved = await migrateKeysFromSettings(store, settings);

  assert.deepEqual(moved, ['anthropicApiKey']);
  assert.equal(cachedKey('anthropicApiKey'), 'sk-ant-old');
  assert.equal(store.data['tpt.apiKey.anthropicApiKey'], 'sk-ant-old');
  assert.deepEqual(settings.removed, ['anthropicApiKey'], 'the plaintext is removed from settings');
});

test('secrets: migration reads the global value when the workspace has none', async () => {
  const store = fakeStore();
  await loadKeys(store);
  const settings = fakeSettings({ openaiApiKey: { global: 'sk-global' } });

  await migrateKeysFromSettings(store, settings);

  assert.equal(cachedKey('openaiApiKey'), 'sk-global');
});

test('secrets: an existing stored key wins over a plaintext one, and the plaintext is still removed', async () => {
  const store = fakeStore({ 'tpt.apiKey.deepseekApiKey': 'ds-stored' });
  await loadKeys(store);
  const settings = fakeSettings({ deepseekApiKey: { workspace: 'ds-old-plaintext' } });

  await migrateKeysFromSettings(store, settings);

  assert.equal(cachedKey('deepseekApiKey'), 'ds-stored');
  assert.deepEqual(settings.removed, ['deepseekApiKey']);
});

test('secrets: migration does nothing for settings without a key', async () => {
  const store = fakeStore();
  await loadKeys(store);
  const settings = fakeSettings({ kimiApiKey: {} });

  assert.deepEqual(await migrateKeysFromSettings(store, settings), []);
  assert.deepEqual(settings.removed, []);
});

test('secrets: clearing removes every key from the store and the cache', async () => {
  const store = fakeStore({ 'tpt.apiKey.openaiApiKey': 'a', 'tpt.apiKey.qwenApiKey': 'b' });
  await loadKeys(store);

  await clearKeys(store);

  assert.deepEqual(store.data, {});
  assert.equal(cachedKey('openaiApiKey'), undefined);
});

test('secrets: getConfig reflects the cached key, so the proxy sees it without settings.json', async () => {
  const store = fakeStore();
  await loadKeys(store);
  await storeKey(store, 'mistralApiKey', 'mis-live');

  assert.equal(getConfig().mistralApiKey, 'mis-live');
  assert.ok(API_KEY_SETTINGS.includes('mistralApiKey'));
});
