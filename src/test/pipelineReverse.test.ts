import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { testConfig } from './helpers/mock-vscode';
import { runPipeline } from '../proxy/pipeline';

afterEach(() => {
  for (const key of Object.keys(testConfig)) delete testConfig[key];
});

const openAIRequest = (path = '/v1/chat/completions') => ({
  method: 'POST',
  path,
  headers: {},
  body: {
    model: 'claude-sonnet-5-5',
    messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: 'hello there' }],
  },
  format: 'openai' as const,
  sessionToken: 'test',
});

test('reverse pipeline: an OpenAI-format request to the Anthropic provider is converted to Anthropic messages', async () => {
  testConfig['upstreamProvider'] = 'anthropic';
  testConfig['router.enabled'] = false;

  const result = await runPipeline(openAIRequest() as never);
  const body = result.body as { system?: string | { text: string }[]; messages: unknown[]; max_tokens?: number };

  assert.equal(result.translated, true);
  // Prompt Cache may wrap the system text in a block with cache_control, so either shape is the same prompt
  const system = typeof body.system === 'string' ? body.system : body.system?.[0].text;
  assert.equal(system, 'be brief');
  assert.equal(body.messages.length, 1, 'the system message moved out of the message list');
  assert.equal(body.max_tokens, 4096);
  assert.ok(result.moduleActions.includes('translate:openai->anthropic'));
});

test('reverse pipeline: an OpenAI-format request to a different provider is not converted', async () => {
  testConfig['upstreamProvider'] = 'openrouter';
  testConfig['router.enabled'] = false;

  const result = await runPipeline(openAIRequest() as never);

  assert.equal(result.translated, false);
  assert.ok((result.body as { messages: unknown[] }).messages.length === 2);
});

test('reverse pipeline: a bodyless request to the Anthropic provider passes through untouched', async () => {
  testConfig['upstreamProvider'] = 'anthropic';
  testConfig['router.enabled'] = false;

  // The server gives a bodyless request an empty object
  const result = await runPipeline({ ...openAIRequest('/v1/models'), body: {} } as never);

  assert.equal(result.translated, false);
});
