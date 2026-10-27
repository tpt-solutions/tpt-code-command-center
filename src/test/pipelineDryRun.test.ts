import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { testConfig } from './helpers/mock-vscode';
import { runPipeline } from '../proxy/pipeline';
import { formatStageSavings } from '../utils/savings';
import { storeCachedResponse, buildCacheScope } from '../modules/tokenShield';
import { Message } from '../proxy/types';

afterEach(() => {
  for (const key of Object.keys(testConfig)) delete testConfig[key];
});

const request = (messages: Message[]) => ({
  method: 'POST',
  path: '/v1/chat/completions',
  headers: {},
  body: { model: 'gpt-4o', messages },
  format: 'openai' as const,
  sessionToken: 'test',
});

test('stage tokens: one count per stage, from the original request to the final body', async () => {
  testConfig['router.enabled'] = false;
  testConfig['memoryWeaver.enabled'] = false;
  testConfig['tokenShield.enabled'] = false;

  const result = await runPipeline(request([{ role: 'user', content: 'hello there '.repeat(20) }]) as never);

  const stages = result.stageTokens.map((s) => s.stage);
  assert.equal(stages[0], 'original');
  assert.equal(stages[stages.length - 1], 'translate');
  assert.ok(stages.indexOf('vault') > stages.indexOf('original'));
  assert.ok(stages.indexOf('silentEdit') > stages.indexOf('smartContext'));
});

test('dry run: a cached answer is not returned, so the request is measured the way it would be sent', async () => {
  testConfig['tokenShield.enabled'] = true;
  testConfig['router.enabled'] = false;
  const messages: Message[] = [{ role: 'user', content: 'dry run cache probe' }];
  const cfg = { enabled: true, maxCacheSizeMB: 256, semanticCache: { enabled: false, similarityThreshold: 0.92, ollamaModel: 'x', ollamaBaseUrl: 'http://localhost:11434' } };
  // Stored under the scope the pipeline computes for this request, or the lookup would miss
  await storeCachedResponse(messages, '{"cached":true}', cfg, buildCacheScope({ model: 'gpt-4o' }, 'openai'));

  testConfig['dryRun'] = false;
  const normal = await runPipeline(request(messages) as never);
  assert.equal(normal.cachedResponse, '{"cached":true}');

  testConfig['dryRun'] = true;
  const dry = await runPipeline(request(messages) as never);
  assert.equal(dry.cachedResponse, undefined);
  assert.ok(dry.stageTokens.length > 0);
});

test('stage formatting: each line shows the change from the stage before, and the net change', () => {
  const lines = formatStageSavings([
    { stage: 'original', tokens: 1000 },
    { stage: 'vault', tokens: 1000 },
    { stage: 'smartContext', tokens: 600 },
    { stage: 'silentEdit', tokens: 650 },
    { stage: 'final', tokens: 650 },
  ]);
  assert.match(lines[2], /600 tokens {2}\(-400\)/);
  assert.match(lines[3], /\(\+50\)/);
  assert.equal(lines[lines.length - 1], 'Net change: -350 tokens (-35.0%)');
});

test('stage formatting: a request with no recorded stages says so', () => {
  assert.deepEqual(formatStageSavings([]), ['(no stage counts recorded)']);
});
