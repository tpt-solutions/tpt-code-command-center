import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'crypto';
import { collectInstalledForge, parseEnvelope, verifyForgePin } from '../modules/forge';

const body = Buffer.from('{"rules":[]}');
const digest = crypto.createHash('sha256').update(body).digest('hex');

test('forge pin: a matching digest passes', () => {
  assert.equal(verifyForgePin(body, digest, 'rules'), true);
});

test('forge pin: the comparison ignores the case of the pinned digest', () => {
  assert.equal(verifyForgePin(body, digest.toUpperCase(), 'rules'), true);
});

test('forge pin: a changed file is refused', () => {
  const tampered = Buffer.from('{"rules":[{"provider":"attacker"}]}');
  assert.throws(() => verifyForgePin(tampered, digest, 'rules'), /hash mismatch for rules/);
});

test('forge pin: an unpinned entry is reported as unverified, not refused', () => {
  assert.equal(verifyForgePin(body, undefined, 'rules'), false);
});

test('forge install: an envelope needs a name and a known type', () => {
  assert.ok(parseEnvelope({ name: 'x', type: 'vault-pattern', version: '1', content: [] }));
  assert.equal(parseEnvelope({ name: 'x', type: 'shell-command', version: '1', content: [] }), undefined);
  assert.equal(parseEnvelope({ type: 'vault-pattern', version: '1', content: [] }), undefined);
  assert.equal(parseEnvelope({ name: 'x', type: 'vault-pattern', version: '1' }), undefined);
});

test('forge install: installed vault patterns and router rules are collected', () => {
  const forge = collectInstalledForge([
    { name: 'v', type: 'vault-pattern', version: '1', content: ['(?i)acme-[a-z0-9]{20}', 42] },
    { name: 'r', type: 'router-rule', version: '1', content: [
      { match: { maxTokens: 100 }, model: 'openai/gpt-4o-mini', provider: 'openrouter' },
      'not a rule',
    ] },
  ]);
  assert.deepEqual(forge.vaultPatterns, ['(?i)acme-[a-z0-9]{20}']);
  assert.deepEqual(forge.routerRules, [{ match: { maxTokens: 100 }, model: 'openai/gpt-4o-mini', provider: 'openrouter' }]);
  assert.equal(forge.systemPrompt, undefined);
});

test('forge install: an installed system prompt supplies the Silent Edit text', () => {
  const forge = collectInstalledForge([
    { name: 's', type: 'system-prompt', version: '1', content: { name: 'n', description: 'd', text: 'Use tpt-edit.' } },
  ]);
  assert.equal(forge.systemPrompt, 'Use tpt-edit.');
});

test('forge install: content of the wrong shape for its type is ignored', () => {
  const forge = collectInstalledForge([
    { name: 'v', type: 'vault-pattern', version: '1', content: 'not an array' },
    { name: 's', type: 'system-prompt', version: '1', content: null },
  ]);
  assert.deepEqual(forge, { routerRules: [], vaultPatterns: [] });
});
