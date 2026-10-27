import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BUILTIN_FORGE_ENTRIES } from '../modules/forge';
import { compileCustomPattern, isSafeRegex } from '../modules/vault';
import { isUpstreamProvider } from '../utils/config';

const byType = (type: string) => BUILTIN_FORGE_ENTRIES.filter((e) => e.type === type);

test('forge builtins: every vault pattern compiles with the vault\'s own compiler', () => {
  const patterns = byType('vault-pattern').flatMap((e) => e.localContent as string[]);
  assert.ok(patterns.length > 0);
  for (const pattern of patterns) {
    assert.ok(compileCustomPattern(pattern), `does not compile: ${pattern}`);
  }
});

test('forge builtins: every vault pattern passes the ReDoS guard, so the vault will not skip it', () => {
  const patterns = byType('vault-pattern').flatMap((e) => e.localContent as string[]);
  for (const pattern of patterns) {
    assert.equal(isSafeRegex(pattern), true, `rejected by the guard: ${pattern}`);
  }
});

test('forge builtins: every router rule names a real provider and has at least one criterion', () => {
  const rules = byType('router-rule').flatMap((e) => e.localContent as Array<{ match: Record<string, unknown>; provider: string }>);
  assert.ok(rules.length > 0);
  for (const rule of rules) {
    assert.equal(isUpstreamProvider(rule.provider), true, `unknown provider: ${rule.provider}`);
    assert.ok(Object.values(rule.match).some((v) => v !== undefined), 'rule with no criteria');
  }
});
