import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as path from 'path';
import { PRESETS, presetsForProvider } from '../ui/presets';
import { isUpstreamProvider } from '../utils/config';

// out/test/presets.test.js → repo root/package.json
const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', '..', 'package.json'), 'utf8'));
const declared = new Set(Object.keys(pkg.contributes.configuration.properties));

test('every preset key is a real tpt setting (catches renamed or removed settings)', () => {
  for (const preset of PRESETS) {
    for (const key of Object.keys(preset.settings)) {
      const full = key.startsWith('tpt.') ? key : `tpt.${key}`;
      assert.ok(declared.has(full), `${preset.id} sets undeclared setting ${full}`);
    }
  }
});

test('preset ids are unique', () => {
  const ids = PRESETS.map((p) => p.id);
  assert.equal(new Set(ids).size, ids.length);
});

test('the Anthropic preset only routes to providers that exist', () => {
  const anthropic = PRESETS.find((p) => p.id === 'anthropic');
  assert.ok(anthropic);
  const rules = anthropic.settings['router.rules'] as Array<{ provider: string }>;
  assert.ok(rules.length > 0);
  for (const rule of rules) assert.equal(isUpstreamProvider(rule.provider), true);
});

test('wizard offers only presets that leave the chosen provider alone, or set it to that same provider', () => {
  const forOpenAi = presetsForProvider('openai').map((p) => p.id);
  assert.ok(forOpenAi.includes('frugal'));
  assert.ok(forOpenAi.includes('privacy'));
  assert.ok(!forOpenAi.includes('local'), 'the local preset would replace an OpenAI choice');
  assert.ok(!forOpenAi.includes('anthropic'), 'the Anthropic preset would replace an OpenAI choice');

  assert.ok(presetsForProvider('anthropic').some((p) => p.id === 'anthropic'));
  assert.ok(presetsForProvider('local').some((p) => p.id === 'local'));
});
