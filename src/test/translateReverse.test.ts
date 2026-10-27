import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  openAIRequestToAnthropic, anthropicResponseToOpenAI, openAIErrorBody, stopReasonToOpenAI, AnthropicStreamToOpenAI,
} from '../modules/translate';

// Pulls the JSON payload out of each "data:" line of an OpenAI stream, skipping [DONE]
function dataEvents(sse: string): Record<string, unknown>[] {
  return sse.split('\n')
    .filter((l) => l.startsWith('data:') && !l.includes('[DONE]'))
    .map((l) => JSON.parse(l.slice(5).trim()) as Record<string, unknown>);
}

// ── request: OpenAI chat -> Anthropic messages ───────────────────────────────

test('reverse request: system and developer messages become one system string', () => {
  const out = openAIRequestToAnthropic({
    model: 'claude-sonnet-5-5',
    messages: [
      { role: 'system', content: 'be brief' },
      { role: 'developer', content: 'use TypeScript' },
      { role: 'user', content: 'hi' },
    ],
  });
  assert.equal(out.system, 'be brief\nuse TypeScript');
  assert.deepEqual(out.messages, [{ role: 'user', content: [{ type: 'text', text: 'hi' }] }]);
});

test('reverse request: max_tokens is required by Anthropic, so a default is supplied; max_completion_tokens wins', () => {
  const plain = openAIRequestToAnthropic({ model: 'm', messages: [{ role: 'user', content: 'x' }] });
  assert.equal(plain.max_tokens, 4096);
  const explicit = openAIRequestToAnthropic({ model: 'm', max_tokens: 100, max_completion_tokens: 300, messages: [] });
  assert.equal(explicit.max_tokens, 300);
});

test('reverse request: an assistant tool call becomes a tool_use block with parsed input', () => {
  const out = openAIRequestToAnthropic({
    model: 'm',
    messages: [
      { role: 'user', content: 'read it' },
      { role: 'assistant', content: null, tool_calls: [{ id: 'call_1', type: 'function', function: { name: 'read', arguments: '{"path":"a.ts"}' } }] },
    ],
  });
  const assistant = (out.messages as { role: string; content: unknown[] }[])[1];
  assert.equal(assistant.role, 'assistant');
  assert.deepEqual(assistant.content, [{ type: 'tool_use', id: 'call_1', name: 'read', input: { path: 'a.ts' } }]);
});

test('reverse request: tool results become tool_result blocks in one user turn', () => {
  const out = openAIRequestToAnthropic({
    model: 'm',
    messages: [
      { role: 'assistant', content: null, tool_calls: [
        { id: 'a', type: 'function', function: { name: 'x', arguments: '{}' } },
        { id: 'b', type: 'function', function: { name: 'y', arguments: '{}' } },
      ] },
      { role: 'tool', tool_call_id: 'a', content: 'first' },
      { role: 'tool', tool_call_id: 'b', content: 'second' },
      { role: 'user', content: 'thanks' },
    ],
  });
  const messages = out.messages as { role: string; content: { type: string; tool_use_id?: string; text?: string }[] }[];
  assert.equal(messages.length, 2, 'the results and the follow-up text share one user turn');
  assert.deepEqual(messages[1].content.map((b) => b.type), ['tool_result', 'tool_result', 'text']);
  assert.equal(messages[1].content[0].tool_use_id, 'a');
});

test('reverse request: a data-URL image becomes a base64 source, another URL a url source', () => {
  const out = openAIRequestToAnthropic({
    model: 'm',
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'look' },
      { type: 'image_url', image_url: { url: 'data:image/png;base64,QUJD' } },
      { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
    ] }],
  });
  const content = (out.messages as { content: Record<string, unknown>[] }[])[0].content;
  assert.deepEqual(content[1], { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'QUJD' } });
  assert.deepEqual(content[2], { type: 'image', source: { type: 'url', url: 'https://example.com/a.png' } });
});

test('reverse request: tools, tool_choice and stop map to their Anthropic forms', () => {
  const out = openAIRequestToAnthropic({
    model: 'm',
    stop: ['END'],
    tools: [{ type: 'function', function: { name: 'read', description: 'reads', parameters: { type: 'object', properties: {} } } }],
    tool_choice: { type: 'function', function: { name: 'read' } },
    messages: [{ role: 'user', content: 'x' }],
  });
  assert.deepEqual(out.stop_sequences, ['END']);
  assert.deepEqual(out.tools, [{ name: 'read', description: 'reads', input_schema: { type: 'object', properties: {} } }]);
  assert.deepEqual(out.tool_choice, { type: 'tool', name: 'read' });
});

test('reverse request: tool_choice is dropped when there are no tools (Anthropic rejects it)', () => {
  const out = openAIRequestToAnthropic({ model: 'm', tool_choice: 'required', messages: [{ role: 'user', content: 'x' }] });
  assert.equal(out.tool_choice, undefined);
});

test('reverse request: consecutive turns of one role are merged into one', () => {
  const out = openAIRequestToAnthropic({
    model: 'm',
    messages: [{ role: 'user', content: 'a' }, { role: 'user', content: 'b' }],
  });
  assert.deepEqual(out.messages, [{ role: 'user', content: [{ type: 'text', text: 'a' }, { type: 'text', text: 'b' }] }]);
});

test('reverse request: stream is carried over', () => {
  assert.equal(openAIRequestToAnthropic({ model: 'm', stream: true, messages: [] }).stream, true);
  assert.equal(openAIRequestToAnthropic({ model: 'm', messages: [] }).stream, false);
});

// ── answer: Anthropic message -> OpenAI chat completion ──────────────────────

test('reverse answer: text becomes the message content with finish_reason stop and usage counted', () => {
  const out = anthropicResponseToOpenAI({
    id: 'msg_1', model: 'claude-sonnet-5-5', stop_reason: 'end_turn',
    content: [{ type: 'text', text: 'hello' }],
    usage: { input_tokens: 12, output_tokens: 3 },
  });
  assert.equal(out.object, 'chat.completion');
  const choice = (out.choices as Record<string, unknown>[])[0];
  assert.deepEqual(choice.message, { role: 'assistant', content: 'hello' });
  assert.equal(choice.finish_reason, 'stop');
  assert.deepEqual(out.usage, { prompt_tokens: 12, completion_tokens: 3, total_tokens: 15 });
});

test('reverse answer: tool_use becomes tool_calls with JSON arguments and finish_reason tool_calls', () => {
  const out = anthropicResponseToOpenAI({
    id: 'msg_2', model: 'm', stop_reason: 'tool_use',
    content: [{ type: 'tool_use', id: 't1', name: 'read', input: { path: 'a.ts' } }],
    usage: { input_tokens: 1, output_tokens: 1 },
  });
  const choice = (out.choices as Record<string, unknown>[])[0];
  const message = choice.message as Record<string, unknown>;
  assert.equal(message.content, null);
  assert.deepEqual(message.tool_calls, [{ id: 't1', type: 'function', function: { name: 'read', arguments: '{"path":"a.ts"}' } }]);
  assert.equal(choice.finish_reason, 'tool_calls');
});

test('reverse answer: max_tokens maps to finish_reason length', () => {
  assert.equal(stopReasonToOpenAI('max_tokens'), 'length');
  assert.equal(stopReasonToOpenAI('end_turn'), 'stop');
  assert.equal(stopReasonToOpenAI('stop_sequence'), 'stop');
});

test('reverse error: an Anthropic error is returned in OpenAI error shape with its message', () => {
  const body = JSON.parse(openAIErrorBody(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'bad key' } })));
  assert.deepEqual(body, { error: { message: 'bad key', type: 'api_error', code: null } });
});

// ── stream: Anthropic events -> OpenAI chunks ────────────────────────────────

const anthropicStream = [
  'event: message_start',
  'data: {"type":"message_start","message":{"id":"msg_9","model":"claude-sonnet-5-5","usage":{"input_tokens":7}}}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":0,"content_block":{"type":"text","text":""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"Hel"}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":0,"delta":{"type":"text_delta","text":"lo"}}',
  '',
  'event: content_block_stop',
  'data: {"type":"content_block_stop","index":0}',
  '',
  'event: content_block_start',
  'data: {"type":"content_block_start","index":1,"content_block":{"type":"tool_use","id":"t1","name":"read","input":{}}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":"{\\"path\\""}}',
  '',
  'event: content_block_delta',
  'data: {"type":"content_block_delta","index":1,"delta":{"type":"input_json_delta","partial_json":":\\"a.ts\\"}"}}',
  '',
  'event: message_delta',
  'data: {"type":"message_delta","delta":{"stop_reason":"tool_use"},"usage":{"output_tokens":9}}',
  '',
  'event: message_stop',
  'data: {"type":"message_stop"}',
  '',
  '',
].join('\n');

test('reverse stream: text and tool calls are converted to OpenAI chunks, ending in [DONE]', () => {
  const converter = new AnthropicStreamToOpenAI();
  const out = converter.push(anthropicStream) + converter.end();

  const events = dataEvents(out);
  const text = events.map((e) => ((e.choices as Record<string, unknown>[])[0].delta as Record<string, unknown>).content)
    .filter((c) => typeof c === 'string').join('');
  assert.equal(text, 'Hello');

  const toolArgs = events
    .flatMap((e) => ((e.choices as Record<string, unknown>[])[0].delta as { tool_calls?: { function?: { arguments?: string } }[] }).tool_calls ?? [])
    .map((c) => c.function?.arguments ?? '').join('');
  assert.equal(toolArgs, '{"path":"a.ts"}', 'the two argument fragments join into the full JSON');

  const last = events[events.length - 1];
  assert.equal((last.choices as Record<string, unknown>[])[0].finish_reason, 'tool_calls');
  assert.ok(out.trimEnd().endsWith('data: [DONE]'));
});

test('reverse stream: usage is sent as a final chunk only when the client asked for it', () => {
  const without = new AnthropicStreamToOpenAI(false);
  const outWithout = without.push(anthropicStream) + without.end();
  assert.equal(dataEvents(outWithout).some((e) => 'usage' in e), false);

  const withUsage = new AnthropicStreamToOpenAI(true);
  const outWith = withUsage.push(anthropicStream) + withUsage.end();
  const usageEvent = dataEvents(outWith).find((e) => 'usage' in e);
  assert.deepEqual(usageEvent?.usage, { prompt_tokens: 7, completion_tokens: 9, total_tokens: 16 });
});

test('reverse stream: an event split across network chunks is still converted', () => {
  const converter = new AnthropicStreamToOpenAI();
  const cut = Math.floor(anthropicStream.length / 2);
  const out = converter.push(anthropicStream.slice(0, cut)) + converter.push(anthropicStream.slice(cut)) + converter.end();
  const text = dataEvents(out)
    .map((e) => ((e.choices as Record<string, unknown>[])[0].delta as Record<string, unknown>).content)
    .filter((c) => typeof c === 'string').join('');
  assert.equal(text, 'Hello');
});

test('reverse stream: a stream that ends without message_stop still closes with one finish chunk and [DONE]', () => {
  const converter = new AnthropicStreamToOpenAI();
  const out = converter.push('data: {"type":"message_start","message":{"id":"m","model":"x"}}\n') + converter.end() + converter.end();
  assert.equal(out.split('[DONE]').length - 1, 1);
  const finishes = dataEvents(out).filter((e) => (e.choices as Record<string, unknown>[])[0].finish_reason !== null);
  assert.equal(finishes.length, 1);
});
