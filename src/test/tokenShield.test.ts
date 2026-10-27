import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildCacheScope, responseHasToolCall } from '../modules/tokenShield';
import { hashPrompt } from '../utils/hash';

const msgs = [{ role: 'user', content: 'same question' }];

test('buildCacheScope: captures model, system, tools and format', () => {
  const scope = buildCacheScope({ model: 'm1', system: 'sys', tools: [{ name: 't' }] }, 'anthropic');
  assert.equal(scope.model, 'm1');
  assert.equal(scope.system, 'sys');
  assert.equal(scope.format, 'anthropic');
});

test('identical messages under different models get different cache keys', () => {
  const a = hashPrompt(msgs, buildCacheScope({ model: 'claude-sonnet-5-5' }, 'anthropic'));
  const b = hashPrompt(msgs, buildCacheScope({ model: 'claude-haiku-5-5' }, 'anthropic'));
  assert.notEqual(a, b);
});

test('identical messages with a different system prompt get different cache keys', () => {
  const a = hashPrompt(msgs, buildCacheScope({ model: 'm', system: 'be brief' }, 'anthropic'));
  const b = hashPrompt(msgs, buildCacheScope({ model: 'm', system: 'be thorough' }, 'anthropic'));
  assert.notEqual(a, b);
});

test('responseHasToolCall: Anthropic tool_use block is detected', () => {
  assert.equal(responseHasToolCall('{"content":[{"type":"tool_use","id":"t1"}]}'), true);
});

test('responseHasToolCall: OpenAI tool_calls are detected', () => {
  assert.equal(responseHasToolCall('{"choices":[{"message":{"tool_calls":[{"id":"1"}]}}]}'), true);
});

test('responseHasToolCall: a plain text answer is not a tool call', () => {
  assert.equal(responseHasToolCall('{"content":[{"type":"text","text":"hello"}]}'), false);
});
