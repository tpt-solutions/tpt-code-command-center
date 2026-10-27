import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildUpstreamPath, isAllowedPath, tokenMatches } from '../proxy/requestPaths';

// ── buildUpstreamPath ─────────────────────────────────────────────────────────

test('buildUpstreamPath: Anthropic root base keeps the client path', () => {
  assert.equal(buildUpstreamPath('/', '/v1/messages'), '/v1/messages');
});

test('buildUpstreamPath: /v1 base + /v1 client path is not doubled (OpenAI-format requests)', () => {
  // OPENAI_BASE_URL=http://127.0.0.1:7331/v1 makes clients call /v1/chat/completions,
  // and the upstream base is https://api.openai.com/v1. Must not become /v1/v1/...
  assert.equal(buildUpstreamPath('/v1', '/v1/chat/completions'), '/v1/chat/completions');
});

test('buildUpstreamPath: /api/v1 base (OpenRouter) keeps its prefix', () => {
  assert.equal(buildUpstreamPath('/api/v1', '/v1/chat/completions'), '/api/v1/chat/completions');
});

test('buildUpstreamPath: base with a non-overlapping prefix is concatenated', () => {
  assert.equal(buildUpstreamPath('/compatible-mode/v1', '/chat/completions'), '/compatible-mode/v1/chat/completions');
});

test('buildUpstreamPath: query string is preserved', () => {
  assert.equal(buildUpstreamPath('/', '/v1/models?limit=5'), '/v1/models?limit=5');
});

// ── isAllowedPath ─────────────────────────────────────────────────────────────

test('isAllowedPath: model endpoints the clients use are allowed', () => {
  assert.equal(isAllowedPath('/v1/messages'), true);
  assert.equal(isAllowedPath('/v1/messages/count_tokens'), true);
  assert.equal(isAllowedPath('/v1/chat/completions'), true);
  assert.equal(isAllowedPath('/v1/models?x=1'), true);
});

test('isAllowedPath: provider admin and file endpoints are refused', () => {
  assert.equal(isAllowedPath('/v1/files'), false);
  assert.equal(isAllowedPath('/v1/batches'), false);
  assert.equal(isAllowedPath('/v1/organizations'), false);
  assert.equal(isAllowedPath('/v1/messagesX'), false);
});

// ── tokenMatches ──────────────────────────────────────────────────────────────

test('tokenMatches: equal token matches', () => {
  assert.equal(tokenMatches('abc123', 'abc123'), true);
});

test('tokenMatches: different or missing token is rejected', () => {
  assert.equal(tokenMatches('abc124', 'abc123'), false);
  assert.equal(tokenMatches(undefined, 'abc123'), false);
  assert.equal(tokenMatches('abc123', undefined), false);
  assert.equal(tokenMatches('', undefined), false);
});

test('tokenMatches: a repeated header (array) is rejected', () => {
  assert.equal(tokenMatches(['abc123', 'abc123'], 'abc123'), false);
});
