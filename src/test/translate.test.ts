import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  anthropicRequestToOpenAI,
  anthropicErrorBody,
  openAIResponseToAnthropic,
  OpenAIStreamToAnthropic,
  stopReasonFromOpenAI,
} from '../modules/translate';

// ── request ───────────────────────────────────────────────────────────────────

test('request: system prompt (string and blocks) becomes the first system message', () => {
  const asString = anthropicRequestToOpenAI({ model: 'm', system: 'be brief', messages: [{ role: 'user', content: 'hi' }] });
  assert.deepEqual((asString.messages as unknown[])[0], { role: 'system', content: 'be brief' });

  const asBlocks = anthropicRequestToOpenAI({
    model: 'm',
    system: [{ type: 'text', text: 'rule one' }, { type: 'text', text: 'rule two' }],
    messages: [{ role: 'user', content: 'hi' }],
  });
  assert.deepEqual((asBlocks.messages as unknown[])[0], { role: 'system', content: 'rule one\nrule two' });
});

test('request: a tool_use and its tool_result become tool_calls and a tool message', () => {
  const out = anthropicRequestToOpenAI({
    model: 'm',
    messages: [
      { role: 'user', content: 'read it' },
      { role: 'assistant', content: [{ type: 'text', text: 'reading' }, { type: 'tool_use', id: 'toolu_1', name: 'Read', input: { path: 'a.ts' } }] },
      { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'toolu_1', content: 'file body' }] },
    ],
  });
  const messages = out.messages as Array<Record<string, unknown>>;
  assert.deepEqual(messages[1], {
    role: 'assistant',
    content: 'reading',
    tool_calls: [{ id: 'toolu_1', type: 'function', function: { name: 'Read', arguments: '{"path":"a.ts"}' } }],
  });
  assert.deepEqual(messages[2], { role: 'tool', tool_call_id: 'toolu_1', content: 'file body' });
  assert.equal(messages.length, 3, 'no empty user message after a pure tool_result turn');
});

test('request: tool definitions and tool_choice are mapped to OpenAI functions', () => {
  const out = anthropicRequestToOpenAI({
    model: 'm',
    messages: [{ role: 'user', content: 'x' }],
    tools: [{ name: 'Read', description: 'read a file', input_schema: { type: 'object', properties: { path: { type: 'string' } } } }],
    tool_choice: { type: 'tool', name: 'Read' },
  });
  assert.deepEqual(out.tools, [{
    type: 'function',
    function: { name: 'Read', description: 'read a file', parameters: { type: 'object', properties: { path: { type: 'string' } } } },
  }]);
  assert.deepEqual(out.tool_choice, { type: 'function', function: { name: 'Read' } });
});

test('request: tool_choice "any" becomes "required"', () => {
  const out = anthropicRequestToOpenAI({ model: 'm', messages: [], tools: [{ name: 'x', input_schema: {} }], tool_choice: { type: 'any' } });
  assert.equal(out.tool_choice, 'required');
});

test('request: sampling and limits carry over; streaming asks for usage', () => {
  const out = anthropicRequestToOpenAI({
    model: 'm', messages: [{ role: 'user', content: 'x' }], max_tokens: 300, temperature: 0.2,
    stop_sequences: ['END'], stream: true,
  });
  assert.equal(out.max_tokens, 300);
  assert.equal(out.temperature, 0.2);
  assert.deepEqual(out.stop, ['END']);
  assert.equal(out.stream, true);
  assert.deepEqual(out.stream_options, { include_usage: true });
});

test('request: an image block becomes an image_url part with a data URI', () => {
  const out = anthropicRequestToOpenAI({
    model: 'm',
    messages: [{ role: 'user', content: [
      { type: 'text', text: 'what is this?' },
      { type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAA' } },
    ] }],
  });
  assert.deepEqual((out.messages as Array<Record<string, unknown>>)[0].content, [
    { type: 'text', text: 'what is this?' },
    { type: 'image_url', image_url: { url: 'data:image/png;base64,AAA' } },
  ]);
});

// ── response ──────────────────────────────────────────────────────────────────

test('response: text and usage become an Anthropic message', () => {
  const out = openAIResponseToAnthropic({
    id: 'chatcmpl-1', model: 'gpt-x',
    choices: [{ message: { role: 'assistant', content: 'hello' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 12, completion_tokens: 3 },
  });
  assert.equal(out.type, 'message');
  assert.deepEqual(out.content, [{ type: 'text', text: 'hello' }]);
  assert.equal(out.stop_reason, 'end_turn');
  assert.deepEqual(out.usage, { input_tokens: 12, output_tokens: 3 });
});

test('response: tool calls become tool_use blocks with parsed input and stop_reason tool_use', () => {
  const out = openAIResponseToAnthropic({
    model: 'm',
    choices: [{ message: { role: 'assistant', content: null, tool_calls: [
      { id: 'call_9', type: 'function', function: { name: 'Read', arguments: '{"path":"b.ts"}' } },
    ] }, finish_reason: 'tool_calls' }],
  });
  assert.deepEqual(out.content, [{ type: 'tool_use', id: 'call_9', name: 'Read', input: { path: 'b.ts' } }]);
  assert.equal(out.stop_reason, 'tool_use');
});

test('response: a length cut-off maps to max_tokens; bad tool arguments become an empty input', () => {
  assert.equal(stopReasonFromOpenAI('length', false), 'max_tokens');
  const out = openAIResponseToAnthropic({
    model: 'm',
    choices: [{ message: { tool_calls: [{ id: 'c', function: { name: 'x', arguments: '{broken' } }] }, finish_reason: 'stop' }],
  });
  assert.deepEqual((out.content as Array<Record<string, unknown>>)[0].input, {});
});

test('errors: an upstream error is returned in Anthropic\'s error shape', () => {
  const body = anthropicErrorBody('{"error":{"message":"invalid api key"}}');
  assert.deepEqual(JSON.parse(body), { type: 'error', error: { type: 'api_error', message: 'invalid api key' } });
  assert.equal(JSON.parse(anthropicErrorBody('plain text')).error.message, 'plain text');
});

// ── streaming ─────────────────────────────────────────────────────────────────

function events(sse: string): Array<{ event: string; data: Record<string, unknown> }> {
  return sse.split('\n\n').filter(Boolean).map((block) => {
    const lines = block.split('\n');
    return { event: lines[0].replace('event: ', ''), data: JSON.parse(lines[1].replace('data: ', '')) };
  });
}

test('stream: text deltas become a text block with text_delta events and a clean end', () => {
  const s = new OpenAIStreamToAnthropic();
  const out = s.push(
    'data: {"id":"c1","model":"m","choices":[{"delta":{"content":"Hel"}}]}\n\n' +
    'data: {"choices":[{"delta":{"content":"lo"}}]}\n\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"stop"}]}\n\n' +
    'data: {"choices":[],"usage":{"prompt_tokens":9,"completion_tokens":2}}\n\n' +
    'data: [DONE]\n\n'
  ) + s.end();
  const names = events(out).map((e) => e.event);
  assert.deepEqual(names, [
    'message_start', 'content_block_start', 'content_block_delta', 'content_block_delta',
    'content_block_stop', 'message_delta', 'message_stop',
  ]);
  const deltas = events(out).filter((e) => e.event === 'content_block_delta').map((e) => (e.data.delta as { text: string }).text);
  assert.equal(deltas.join(''), 'Hello');
  const last = events(out).find((e) => e.event === 'message_delta')!;
  assert.deepEqual(last.data.delta, { stop_reason: 'end_turn', stop_sequence: null });
  assert.deepEqual(last.data.usage, { output_tokens: 2 });
});

test('stream: streamed tool calls become tool_use blocks with input_json_delta events', () => {
  const s = new OpenAIStreamToAnthropic();
  const out = s.push(
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"call_a","function":{"name":"Read","arguments":""}}]}}]}\n\n' +
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"{\\"path\\":"}}]}}]}\n\n' +
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":"\\"c.ts\\"}"}}]}}]}\n\n' +
    'data: {"choices":[{"delta":{},"finish_reason":"tool_calls"}]}\n\n' +
    'data: [DONE]\n\n'
  ) + s.end();
  const start = events(out).find((e) => e.event === 'content_block_start')!;
  assert.deepEqual(start.data.content_block, { type: 'tool_use', id: 'call_a', name: 'Read', input: {} });
  const json = events(out).filter((e) => e.event === 'content_block_delta')
    .map((e) => (e.data.delta as { partial_json: string }).partial_json).join('');
  assert.deepEqual(JSON.parse(json), { path: 'c.ts' });
  const last = events(out).find((e) => e.event === 'message_delta')!;
  assert.equal((last.data.delta as { stop_reason: string }).stop_reason, 'tool_use');
});

test('stream: a text block is closed before a tool block opens', () => {
  const s = new OpenAIStreamToAnthropic();
  const out = s.push(
    'data: {"choices":[{"delta":{"content":"Let me check."}}]}\n\n' +
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"c","function":{"name":"Read","arguments":"{}"}}]}}]}\n\n'
  ) + s.end();
  const names = events(out).map((e) => e.event);
  assert.deepEqual(names.slice(0, 5), ['message_start', 'content_block_start', 'content_block_delta', 'content_block_stop', 'content_block_start']);
});

test('stream: lines split across chunks are reassembled', () => {
  const whole = 'data: {"choices":[{"delta":{"content":"split"}}]}\n\n';
  const s = new OpenAIStreamToAnthropic();
  const out = s.push(whole.slice(0, 20)) + s.push(whole.slice(20)) + s.end();
  const text = events(out).filter((e) => e.event === 'content_block_delta')
    .map((e) => (e.data.delta as { text: string }).text).join('');
  assert.equal(text, 'split');
});

test('stream: an upstream that ends without a finish still closes the message', () => {
  const s = new OpenAIStreamToAnthropic();
  const out = s.push('data: {"choices":[{"delta":{"content":"cut"}}]}\n\n') + s.end();
  assert.equal(events(out).at(-1)!.event, 'message_stop');
  assert.equal(s.end(), '', 'a second end adds nothing');
});
