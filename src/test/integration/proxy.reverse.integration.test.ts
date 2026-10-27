/**
 * End-to-end tests of the reverse direction and of dry run, through the real proxy (src/proxy/server.ts).
 *
 * The Anthropic provider is pointed at a local stand-in that speaks the Anthropic messages format, so
 * the tests check what really leaves the proxy and what an OpenAI-format client gets back.
 */

import '../helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'http';
import * as net from 'net';
import { testConfig } from '../helpers/mock-vscode';
import { startProxyServer, stopProxyServer, getProxyUrl, getSessionToken } from '../../proxy/server';
import { setAnthropicBaseUrlForTests } from '../../utils/config';

interface Seen {
  path: string;
  body: string;
  apiKey?: string;
}

const seen: Seen[] = [];
let stand: http.Server;

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer();
    srv.listen(0, '127.0.0.1', () => {
      const addr = srv.address() as net.AddressInfo;
      srv.close(() => resolve(addr.port));
    });
    srv.on('error', reject);
  });
}

// Calls the running proxy the way an OpenAI-format client would
function callProxy(path: string, body: string): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(getProxyUrl()!);
    const req = http.request(
      {
        hostname: url.hostname, port: Number(url.port), path, method: 'POST',
        headers: {
          'x-tpt-token': getSessionToken()!,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

// What the Anthropic stand-in answers: a streamed reply, a plain one, or an error when asked to
function answer(res: http.ServerResponse, path: string, body: string): void {
  if (path.endsWith('/chat/completions')) {
    res.writeHead(200, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'dry run reply' } }] }));
    return;
  }
  if (body.includes('please fail')) {
    res.writeHead(400, { 'content-type': 'application/json' });
    res.end(JSON.stringify({ type: 'error', error: { type: 'invalid_request_error', message: 'bad request from stand-in' } }));
    return;
  }
  if (/"stream"\s*:\s*true/.test(body)) {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    const events = [
      ['message_start', { type: 'message_start', message: { id: 'msg_e2e', model: 'claude-sonnet-5-5', usage: { input_tokens: 9 } } }],
      ['content_block_start', { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'Hel' } }],
      ['content_block_delta', { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: 'lo' } }],
      ['content_block_stop', { type: 'content_block_stop', index: 0 }],
      ['message_delta', { type: 'message_delta', delta: { stop_reason: 'end_turn' }, usage: { output_tokens: 4 } }],
      ['message_stop', { type: 'message_stop' }],
    ] as const;
    for (const [event, data] of events) res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    res.end();
    return;
  }
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({
    id: 'msg_e2e', type: 'message', role: 'assistant', model: 'claude-sonnet-5-5',
    content: [{ type: 'text', text: 'hello from the stand-in' }],
    stop_reason: 'end_turn', usage: { input_tokens: 12, output_tokens: 5 },
  }));
}

before(async () => {
  const port = await freePort();
  stand = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      seen.push({ path: req.url ?? '', body, apiKey: req.headers['x-api-key'] as string | undefined });
      answer(res, req.url ?? '', body);
    });
  });
  await new Promise<void>((resolve) => stand.listen(port, 'localhost', resolve));

  setAnthropicBaseUrlForTests(`http://localhost:${port}`);
  testConfig['upstreamProvider'] = 'anthropic';
  testConfig['anthropicApiKey'] = 'sk-e2e-key';
  testConfig['tokenShield.enabled'] = false; // identical prompts across tests must reach the stand-in
  testConfig['router.enabled'] = false;

  const context = { globalState: { get: () => undefined, update: async () => undefined } } as never;
  await startProxyServer(context);
});

after(async () => {
  await stopProxyServer();
  setAnthropicBaseUrlForTests(undefined);
  stand.close();
});

const openAIChat = (extra: Record<string, unknown> = {}, text = 'hello there') => JSON.stringify({
  model: 'claude-sonnet-5-5',
  messages: [{ role: 'system', content: 'be brief' }, { role: 'user', content: text }],
  ...extra,
});

test('reverse e2e: an OpenAI-format request reaches Anthropic as messages, and the answer comes back as chat', async () => {
  seen.length = 0;
  const res = await callProxy('/v1/chat/completions', openAIChat());

  assert.equal(res.status, 200);
  const sent = seen[0];
  assert.equal(sent.path, '/v1/messages');
  assert.equal(sent.apiKey, 'sk-e2e-key');
  const upstreamBody = JSON.parse(sent.body) as { system?: string | { text: string }[]; messages: { role: string }[] };
  // Prompt Cache may wrap the system text in a block with cache_control; either shape is the same prompt
  const system = typeof upstreamBody.system === 'string' ? upstreamBody.system : upstreamBody.system?.[0].text;
  assert.equal(system, 'be brief');
  assert.ok(upstreamBody.messages.every((m) => m.role !== 'system'));

  const answerBody = JSON.parse(res.body) as { object: string; choices: { message: { content: string }; finish_reason: string }[] };
  assert.equal(answerBody.object, 'chat.completion');
  assert.equal(answerBody.choices[0].message.content, 'hello from the stand-in');
  assert.equal(answerBody.choices[0].finish_reason, 'stop');
});

test('reverse e2e: a streamed request comes back as OpenAI chunks ending in [DONE]', async () => {
  seen.length = 0;
  const res = await callProxy('/v1/chat/completions', openAIChat({ stream: true, stream_options: { include_usage: true } }));

  assert.equal(res.status, 200);
  const chunks = res.body.split('\n').filter((l) => l.startsWith('data:') && !l.includes('[DONE]'))
    .map((l) => JSON.parse(l.slice(5).trim()) as { choices: { delta: { content?: string }; finish_reason: string | null }[]; usage?: unknown });
  const text = chunks.map((c) => c.choices[0]?.delta?.content ?? '').join('');
  assert.equal(text, 'Hello');
  assert.ok(res.body.trimEnd().endsWith('data: [DONE]'));
  assert.ok(chunks.some((c) => c.usage !== undefined), 'usage is sent because the client asked for it');
});

test('reverse e2e: an Anthropic error comes back in OpenAI error shape, with its message', async () => {
  seen.length = 0;
  const res = await callProxy('/v1/chat/completions', openAIChat({}, 'please fail'));

  assert.equal(res.status, 400);
  const body = JSON.parse(res.body) as { error: { message: string; type: string } };
  assert.equal(body.error.message, 'bad request from stand-in');
  assert.equal(body.error.type, 'api_error');
});

test('dry run e2e: the request is sent to the provider byte for byte as the client wrote it', async () => {
  testConfig['dryRun'] = true;
  seen.length = 0;
  const sentByClient = openAIChat({ model: 'gpt-4o', temperature: 0.25 }, 'dry run request');

  const res = await callProxy('/v1/chat/completions', sentByClient);

  testConfig['dryRun'] = false;
  assert.equal(res.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].body, sentByClient, 'nothing the modules measured reaches the provider');
  assert.equal(seen[0].path, '/v1/chat/completions');
});

test('count_tokens e2e: an Anthropic-format client routed to an OpenAI-compatible provider gets a local count, and nothing is sent', async () => {
  testConfig['router.enabled'] = true;
  testConfig['router.rules'] = [{ match: { maxTokens: 100000 }, model: 'local-model', provider: 'local' }];
  seen.length = 0;
  const body = JSON.stringify({
    model: 'claude-sonnet-5-5',
    messages: [{ role: 'user', content: 'how many tokens is this conversation' }],
  });

  const res = await callProxy('/v1/messages/count_tokens', body);

  testConfig['router.enabled'] = false;
  delete testConfig['router.rules'];
  assert.equal(res.status, 200);
  const counted = JSON.parse(res.body) as { input_tokens: number };
  assert.equal(typeof counted.input_tokens, 'number');
  assert.ok(counted.input_tokens > 0);
  assert.equal(seen.length, 0, 'the count is answered by TPT, not by a provider');
});
