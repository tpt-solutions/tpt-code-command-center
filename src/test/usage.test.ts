import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readUpstreamUsage } from '../ledger/usage';

test('non-streamed Anthropic: input includes cache reads and writes', () => {
  const body = JSON.stringify({
    usage: { input_tokens: 10, cache_creation_input_tokens: 200, cache_read_input_tokens: 3000, output_tokens: 42 },
  });
  assert.deepEqual(readUpstreamUsage(body, 'anthropic', false), {
    inputTokens: 3210,
    outputTokens: 42,
    cacheReadTokens: 3000,
    cacheWriteTokens: 200,
  });
});

test('non-streamed OpenAI: prompt and completion tokens', () => {
  const body = JSON.stringify({ usage: { prompt_tokens: 120, completion_tokens: 7, total_tokens: 127 } });
  assert.deepEqual(readUpstreamUsage(body, 'openai', false), { inputTokens: 120, outputTokens: 7 });
});

test('non-streamed: a body without usage gives no counts', () => {
  assert.deepEqual(readUpstreamUsage('{"error":"nope"}', 'openai', false), {});
});

test('non-streamed: a body that is not JSON gives no counts', () => {
  assert.deepEqual(readUpstreamUsage('<html>502</html>', 'anthropic', false), {});
});

test('streamed Anthropic: input from message_start, final output from message_delta', () => {
  const sse = [
    'event: message_start',
    'data: {"type":"message_start","message":{"usage":{"input_tokens":25,"output_tokens":1}}}',
    'event: content_block_delta',
    'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"hi"}}',
    'event: message_delta',
    'data: {"type":"message_delta","usage":{"output_tokens":15}}',
    'event: message_delta',
    'data: {"type":"message_delta","usage":{"output_tokens":19}}',
    'data: [DONE]',
  ].join('\n');
  assert.deepEqual(readUpstreamUsage(sse, 'anthropic', true), { inputTokens: 25, outputTokens: 19 });
});

test('streamed OpenAI: usage from the final chunk when the client asked for it', () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"a"}}]}',
    'data: {"choices":[],"usage":{"prompt_tokens":60,"completion_tokens":9}}',
    'data: [DONE]',
  ].join('\n');
  assert.deepEqual(readUpstreamUsage(sse, 'openai', true), { inputTokens: 60, outputTokens: 9 });
});

test('streamed OpenAI without usage: no counts, so the caller estimates', () => {
  const sse = 'data: {"choices":[{"delta":{"content":"a"}}]}\n\ndata: [DONE]';
  assert.deepEqual(readUpstreamUsage(sse, 'openai', true), {});
});

test('streamed Anthropic: cache counts come from message_start', () => {
  const sse = 'data: {"type":"message_start","message":{"usage":{"input_tokens":4,"cache_read_input_tokens":900,"cache_creation_input_tokens":50}}}';
  assert.deepEqual(readUpstreamUsage(sse, 'anthropic', true), {
    inputTokens: 954,
    cacheReadTokens: 900,
    cacheWriteTokens: 50,
  });
});

test('streamed: malformed events are skipped', () => {
  const sse = 'data: {not json\ndata: {"type":"message_start","message":{"usage":{"input_tokens":5}}}';
  assert.deepEqual(readUpstreamUsage(sse, 'anthropic', true), { inputTokens: 5 });
});
