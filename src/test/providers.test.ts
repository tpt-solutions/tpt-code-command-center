import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { resolveUpstreamUrl, isUpstreamProvider, TptConfig } from '../utils/config';
import { buildUpstreamPath, upstreamRequestPath } from '../proxy/requestPaths';

const cfg = (extra: Partial<TptConfig>): TptConfig => extra as TptConfig;

test('groq: resolves to its OpenAI-compatible endpoint with the groq key', () => {
  const up = resolveUpstreamUrl(cfg({ upstreamProvider: 'groq', groqApiKey: 'gsk-test' }));
  assert.equal(up.baseUrl, 'https://api.groq.com/openai/v1');
  assert.equal(up.apiKey, 'gsk-test');
});

test('gemini: resolves to Google\'s OpenAI-compatible endpoint with the gemini key', () => {
  const up = resolveUpstreamUrl(cfg({ upstreamProvider: 'gemini', geminiApiKey: 'AIza-test' }));
  assert.equal(up.baseUrl, 'https://generativelanguage.googleapis.com/v1beta/openai');
  assert.equal(up.apiKey, 'AIza-test');
});

test('the new providers are valid upstream provider names', () => {
  assert.equal(isUpstreamProvider('groq'), true);
  assert.equal(isUpstreamProvider('gemini'), true);
});

test('groq: client /v1 paths are joined to the base without repeating /v1', () => {
  const base = resolveUpstreamUrl(cfg({ upstreamProvider: 'groq', groqApiKey: 'k' })).baseUrl;
  const path = upstreamRequestPath('groq', '/v1/chat/completions');
  assert.equal(buildUpstreamPath(new URL(base).pathname, path), '/openai/v1/chat/completions');
});

test('gemini: the client /v1 is dropped so the path lands under /v1beta/openai', () => {
  const base = resolveUpstreamUrl(cfg({ upstreamProvider: 'gemini', geminiApiKey: 'k' })).baseUrl;
  const chat = upstreamRequestPath('gemini', '/v1/chat/completions');
  const models = upstreamRequestPath('gemini', '/v1/models?pageSize=5');
  assert.equal(buildUpstreamPath(new URL(base).pathname, chat), '/v1beta/openai/chat/completions');
  assert.equal(buildUpstreamPath(new URL(base).pathname, models), '/v1beta/openai/models?pageSize=5');
});

test('upstreamRequestPath: other providers keep the client path unchanged', () => {
  assert.equal(upstreamRequestPath('openai', '/v1/chat/completions'), '/v1/chat/completions');
  assert.equal(upstreamRequestPath('anthropic', '/v1/messages'), '/v1/messages');
});
