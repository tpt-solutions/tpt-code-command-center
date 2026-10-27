import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as crypto from 'crypto';
import { verifyForgePin } from '../modules/forge';

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
