import { test } from 'node:test';
import assert from 'node:assert/strict';
import { hashPrompt, hashString } from '../utils/hash';

test('hashPrompt: identical messages produce identical hash', () => {
  const msgs = [{ role: 'user', content: 'hello' }];
  assert.equal(hashPrompt(msgs), hashPrompt(msgs));
});

test('hashPrompt: different content produces different hash', () => {
  const a = [{ role: 'user', content: 'hello' }];
  const b = [{ role: 'user', content: 'world' }];
  assert.notEqual(hashPrompt(a), hashPrompt(b));
});

test('hashPrompt: whitespace is significant (no collapsing)', () => {
  const a = [{ role: 'user', content: 'hello   world' }];
  const b = [{ role: 'user', content: 'hello world' }];
  assert.notEqual(hashPrompt(a), hashPrompt(b));
});

test('hashPrompt: comparison is case-sensitive', () => {
  const a = [{ role: 'user', content: 'Hello World' }];
  const b = [{ role: 'user', content: 'hello world' }];
  assert.notEqual(hashPrompt(a), hashPrompt(b));
});

test('hashPrompt: indentation inside content is preserved (Python-safe)', () => {
  const a = [{ role: 'user', content: 'def f():\n    return 1' }];
  const b = [{ role: 'user', content: 'def f():\n return 1' }];
  assert.notEqual(hashPrompt(a), hashPrompt(b));
});

test('hashPrompt: scope (model, system, tools) changes the key', () => {
  const msgs = [{ role: 'user', content: 'hello' }];
  const base = hashPrompt(msgs, { model: 'claude-sonnet-5-5' });
  assert.notEqual(base, hashPrompt(msgs, { model: 'claude-haiku-5-5' }));
  assert.notEqual(base, hashPrompt(msgs, { model: 'claude-sonnet-5-5', system: 'be terse' }));
  assert.notEqual(base, hashPrompt(msgs, { model: 'claude-sonnet-5-5', tools: [{ name: 'x' }] }));
  assert.notEqual(base, hashPrompt(msgs, { model: 'claude-sonnet-5-5', format: 'openai' }));
});

test('hashPrompt: returns 64-character lowercase hex string', () => {
  const h = hashPrompt([{ role: 'user', content: 'test' }]);
  assert.equal(h.length, 64);
  assert.match(h, /^[0-9a-f]+$/);
});

test('hashString: same input → same output', () => {
  assert.equal(hashString('hello'), hashString('hello'));
});

test('hashString: different input → different output', () => {
  assert.notEqual(hashString('hello'), hashString('hello!'));
});

test('hashString: returns 64-character lowercase hex string', () => {
  const h = hashString('any string');
  assert.equal(h.length, 64);
  assert.match(h, /^[0-9a-f]+$/);
});

test('hashString: empty string produces a valid hash (not an error)', () => {
  assert.doesNotThrow(() => {
    const h = hashString('');
    assert.equal(h.length, 64);
  });
});
