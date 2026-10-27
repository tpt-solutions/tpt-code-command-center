import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { testConfig } from './helpers/mock-vscode';
import { runPipeline } from '../proxy/pipeline';

const request = (model: string) => ({
  method: 'POST',
  path: '/v1/chat/completions',
  headers: {},
  body: { model, messages: [{ role: 'user', content: 'hello there' }] },
  format: 'openai' as const,
  sessionToken: 'test',
});

afterEach(() => {
  for (const key of Object.keys(testConfig)) delete testConfig[key];
});

test('Mistral: the prompt_cache_key is set when the request really goes to Mistral', async () => {
  testConfig['upstreamProvider'] = 'mistral';
  testConfig['router.enabled'] = false;

  const result = await runPipeline(request('mistral-small') as never);

  assert.ok((result.body as { prompt_cache_key?: string }).prompt_cache_key);
});

test('Mistral: a request the router sends elsewhere does not get the Mistral-only field', async () => {
  testConfig['upstreamProvider'] = 'mistral';
  testConfig['router.enabled'] = true;
  testConfig['router.rules'] = [{ match: { maxTokens: 2000 }, model: 'routed-model', provider: 'local' }];

  const result = await runPipeline(request('client-model') as never);

  assert.equal((result.body as { prompt_cache_key?: string }).prompt_cache_key, undefined);
  assert.equal((result.body as { model: string }).model, 'routed-model');
});
