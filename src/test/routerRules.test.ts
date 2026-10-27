import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  runRouter,
  getLastUserContent,
  getExtensionsInMessages,
  estimateTokensInMessages,
  providerFormat,
} from '../modules/router';
import { Message } from '../proxy/types';

const shortChat: Message[] = [{ role: 'user', content: 'hi there' }];

test('runRouter: matching rule returns the routed provider and model', () => {
  const rules = [{ match: { maxTokens: 2000 }, model: 'gpt-4o-mini', provider: 'openai' }];
  const result = runRouter({ messages: shortChat }, rules, 'openai');
  assert.ok(result);
  assert.equal(result.model, 'gpt-4o-mini');
  assert.equal(result.provider, 'openai');
});

test('runRouter: unknown provider is skipped (would otherwise send the OpenRouter key elsewhere)', () => {
  const rules = [{ match: { maxTokens: 2000 }, model: 'x', provider: 'not-a-provider' }];
  assert.equal(runRouter({ messages: shortChat }, rules, 'openai'), undefined);
});

test('runRouter: a rule with no criteria is skipped instead of catching every request', () => {
  const rules = [{ match: {}, model: 'x', provider: 'openai' }];
  assert.equal(runRouter({ messages: shortChat }, rules, 'openai'), undefined);
});

test('runRouter: an Anthropic-format request can be routed to an OpenAI-compatible provider (translated)', () => {
  const rules = [{ match: { maxTokens: 2000 }, model: 'gpt-4o-mini', provider: 'openrouter' }];
  const result = runRouter({ messages: shortChat }, rules, 'anthropic');
  assert.ok(result);
  assert.equal(result.provider, 'openrouter');
});

test('runRouter: an OpenAI-format request is not routed to the Anthropic provider (no translation that way)', () => {
  const rules = [{ match: { maxTokens: 2000 }, model: 'claude-haiku-5-5', provider: 'anthropic' }];
  assert.equal(runRouter({ messages: shortChat }, rules, 'openai'), undefined);
});

test('runRouter: an anthropic-provider rule applies to anthropic-format requests', () => {
  const rules = [{ match: { maxTokens: 2000 }, model: 'claude-haiku-5-5', provider: 'anthropic' }];
  const result = runRouter({ messages: shortChat }, rules, 'anthropic');
  assert.ok(result);
  assert.equal(result.provider, 'anthropic');
});

test('runRouter: keyword matches only the user\'s typed text, not tool output', () => {
  const messages: Message[] = [
    { role: 'user', content: 'please look at the build' },
    { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { file_path: 'a.log' } }] as never },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'ERROR: fix this now' }] as never },
  ];
  const rules = [{ match: { keywords: ['error'] }, model: 'x', provider: 'openai' }];
  assert.equal(runRouter({ messages }, rules, 'openai'), undefined);
});

test('getLastUserContent: skips a tool-result-only user turn and returns the typed text', () => {
  const messages: Message[] = [
    { role: 'user', content: 'refactor the parser' },
    { role: 'assistant', content: 'ok' },
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'file body' }] as never },
  ];
  assert.equal(getLastUserContent(messages), 'refactor the parser');
});

test('getExtensionsInMessages: extensions inside tool results are ignored', () => {
  const messages: Message[] = [
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'import x from "./lib.rs"' }] as never },
  ];
  assert.deepEqual(getExtensionsInMessages(messages), []);
});

test('getExtensionsInMessages: extension at end of line is detected', () => {
  const messages: Message[] = [{ role: 'user', content: 'edit src/main.rs\nthen run it' }];
  assert.deepEqual(getExtensionsInMessages(messages), ['rs']);
});

test('estimateTokensInMessages: tool_result content is counted, so large tool contexts route correctly', () => {
  const big = 'x'.repeat(8000);
  const messages: Message[] = [
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: big }] as never },
  ];
  assert.ok(estimateTokensInMessages(messages) >= 2000);
});

test('built-in rules: a small code request reaches the code model, not the short-prompt model', () => {
  const messages: Message[] = [{ role: 'user', content: 'fix src/index.ts please' }];
  const result = runRouter({ messages }, [], 'openai');
  assert.ok(result);
  assert.equal(result.model, 'openai/gpt-4o');
});

test('providerFormat: only anthropic speaks the Anthropic format', () => {
  assert.equal(providerFormat('anthropic'), 'anthropic');
  assert.equal(providerFormat('openrouter'), 'openai');
  assert.equal(providerFormat('mistral'), 'openai');
});
