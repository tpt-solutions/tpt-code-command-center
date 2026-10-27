/**
 * End-to-end test of the real proxy (src/proxy/server.ts), not a hand-written forwarder.
 *
 * The proxy runs in this process with vscode stubbed. Traffic is routed to a mock upstream by
 * setting the "local" provider's base URL (localhost is allowed by name). The mock records what
 * the proxy sent, so the tests check what really leaves the proxy.
 */

import '../helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'http';
import * as net from 'net';
import { testConfig } from '../helpers/mock-vscode';
import { startProxyServer, stopProxyServer, getProxyUrl, getSessionToken } from '../../proxy/server';

interface Seen {
  method: string;
  path: string;
  body: string;
  authorization?: string;
}

const seen: Seen[] = [];
// Set when the mock upstream sees its streaming response closed (the proxy went away)
let upstreamStreamClosed = false;
let upstream: http.Server;
let upstreamPort: number;

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

// Calls the running proxy the way a client would
function callProxy(method: string, path: string, body: string | undefined, token: string | undefined): Promise<{ status: number; body: string }> {
  return new Promise((resolve, reject) => {
    const url = new URL(getProxyUrl()!);
    const headers: Record<string, string> = {};
    if (token !== undefined) headers['x-tpt-token'] = token;
    if (body !== undefined) {
      headers['content-type'] = 'application/json';
      headers['content-length'] = Buffer.byteLength(body).toString();
    }
    const req = http.request(
      { hostname: url.hostname, port: Number(url.port), path, method, headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => resolve({ status: res.statusCode ?? 0, body: Buffer.concat(chunks).toString('utf8') }));
      }
    );
    req.on('error', reject);
    if (body !== undefined) req.write(body);
    req.end();
  });
}

function setRouter(rules: unknown[] | undefined): void {
  testConfig['router.enabled'] = rules !== undefined;
  if (rules !== undefined) testConfig['router.rules'] = rules;
}

before(async () => {
  upstreamPort = await freePort();
  // Listen on all interfaces: "localhost" may resolve to ::1 or 127.0.0.1
  upstream = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const body = Buffer.concat(chunks).toString('utf8');
      seen.push({ method: req.method ?? '', path: req.url ?? '', body, authorization: req.headers.authorization });

      if (/"stream"\s*:\s*true/.test(body)) {
        // A stream that keeps going until the proxy closes it
        res.writeHead(200, { 'content-type': 'text/event-stream' });
        res.write('data: {"choices":[{"delta":{"content":"a"}}]}\n\n');
        const timer = setInterval(() => res.write('data: {"choices":[{"delta":{"content":"b"}}]}\n\n'), 20);
        res.on('close', () => {
          clearInterval(timer);
          upstreamStreamClosed = true;
        });
        return;
      }

      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ choices: [{ message: { role: 'assistant', content: 'ok' } }], usage: { completion_tokens: 1 } }));
    });
  });
  await new Promise<void>((resolve) => upstream.listen(upstreamPort, resolve));

  testConfig['upstreamProvider'] = 'local';
  testConfig['localBaseUrl'] = `http://localhost:${upstreamPort}/v1`;
  testConfig['tokenShield.enabled'] = false; // identical prompts across tests must reach the upstream
  testConfig['router.enabled'] = false;

  // The proxy only needs globalState from the extension context
  const context = { globalState: { get: () => undefined, update: async () => undefined } } as never;
  await startProxyServer(context);
});

after(async () => {
  await stopProxyServer();
  upstream.close();
});

const chatBody = (model: string) =>
  JSON.stringify({ model, messages: [{ role: 'user', content: 'hello' }] });

test('router: the routed model reaches the upstream and the /v1 path is not doubled', async () => {
  setRouter([{ match: { maxTokens: 2000 }, model: 'routed-model', provider: 'local' }]);
  seen.length = 0;

  const res = await callProxy('POST', '/v1/chat/completions', chatBody('client-model'), getSessionToken());

  assert.equal(res.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].path, '/v1/chat/completions');
  assert.equal(JSON.parse(seen[0].body).model, 'routed-model');
  setRouter(undefined);
});

test('router: a rule for the other API format is not applied (body is not translated)', async () => {
  setRouter([{ match: { maxTokens: 2000 }, model: 'claude-haiku-5-5', provider: 'anthropic' }]);
  seen.length = 0;

  const res = await callProxy('POST', '/v1/chat/completions', chatBody('client-model'), getSessionToken());

  assert.equal(res.status, 200);
  assert.equal(JSON.parse(seen[0].body).model, 'client-model');
  setRouter(undefined);
});

test('router: the auth header follows the routed provider, not the global one', async () => {
  // Global provider is "local" (no key). The routed "custom" provider has a key.
  testConfig['customBaseUrl'] = `http://localhost:${upstreamPort}/v1`;
  testConfig['customApiKey'] = 'routed-secret';
  setRouter([{ match: { maxTokens: 2000 }, model: 'm2', provider: 'custom' }]);
  seen.length = 0;

  const res = await callProxy('POST', '/v1/chat/completions', chatBody('m1'), getSessionToken());

  assert.equal(res.status, 200);
  assert.equal(seen[0].authorization, 'Bearer routed-secret');
  assert.equal(seen[0].path, '/v1/chat/completions');
  setRouter(undefined);
  delete testConfig['customApiKey'];
});

test('streaming: the client going away stops the upstream stream', async () => {
  upstreamStreamClosed = false;
  const url = new URL(getProxyUrl()!);
  const body = JSON.stringify({ model: 'm', stream: true, messages: [{ role: 'user', content: 'go on' }] });

  await new Promise<void>((resolve) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: Number(url.port),
        path: '/v1/chat/completions',
        method: 'POST',
        headers: {
          'x-tpt-token': getSessionToken()!,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        // First chunk arrived: the stream is live. Now the client disconnects.
        res.once('data', () => {
          req.destroy();
          resolve();
        });
      }
    );
    req.on('error', () => { /* destroying the client socket reports an error here; expected */ });
    req.write(body);
    req.end();
  });

  for (let i = 0; i < 100 && !upstreamStreamClosed; i++) {
    await new Promise((r) => setTimeout(r, 20));
  }
  assert.equal(upstreamStreamClosed, true);
});

test('passthrough: a bodyless GET /v1/models is forwarded with the token and no body', async () => {
  seen.length = 0;

  const res = await callProxy('GET', '/v1/models', undefined, getSessionToken());

  assert.equal(res.status, 200);
  assert.equal(seen.length, 1);
  assert.equal(seen[0].method, 'GET');
  assert.equal(seen[0].path, '/v1/models');
});

test('auth: a request without the session token is refused before anything is forwarded', async () => {
  seen.length = 0;

  const res = await callProxy('POST', '/v1/chat/completions', chatBody('m'), undefined);

  assert.equal(res.status, 401);
  assert.equal(seen.length, 0);
});

test('auth: a wrong session token is refused', async () => {
  seen.length = 0;

  const res = await callProxy('POST', '/v1/chat/completions', chatBody('m'), 'not-the-token');

  assert.equal(res.status, 401);
  assert.equal(seen.length, 0);
});

// Sends one request with the given headers, for clients that send the token as their API key
function callWithHeaders(headers: Record<string, string>): Promise<number> {
  return new Promise((resolve, reject) => {
    const url = new URL(getProxyUrl()!);
    const body = chatBody('m');
    const req = http.request(
      {
        hostname: url.hostname,
        port: Number(url.port),
        path: '/v1/chat/completions',
        method: 'POST',
        headers: { ...headers, 'content-type': 'application/json', 'content-length': Buffer.byteLength(body).toString() },
      },
      (res) => {
        res.resume();
        res.on('end', () => resolve(res.statusCode ?? 0));
      }
    );
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

test('auth: the session token works as the Bearer API key that Roo Code and Continue send', async () => {
  seen.length = 0;
  const status = await callWithHeaders({ authorization: `Bearer ${getSessionToken()}` });
  assert.equal(status, 200);
  assert.equal(seen.length, 1);
  // The client's key is never forwarded: the upstream sees no authorization header from it
  assert.equal(seen[0].authorization, undefined);
});

test('auth: the session token works as x-api-key, which Claude Code sends', async () => {
  seen.length = 0;
  const status = await callWithHeaders({ 'x-api-key': getSessionToken()! });
  assert.equal(status, 200);
});

test('auth: a provider key that is not the session token is refused', async () => {
  seen.length = 0;
  const status = await callWithHeaders({ authorization: 'Bearer sk-some-real-provider-key' });
  assert.equal(status, 401);
  assert.equal(seen.length, 0);
});

test('translation: an Anthropic request routed to an OpenAI-compatible provider reaches it as OpenAI chat, and the answer comes back as an Anthropic message', async () => {
  setRouter([{ match: { maxTokens: 2000 }, model: 'routed-model', provider: 'local' }]);
  seen.length = 0;
  const body = JSON.stringify({
    model: 'claude-sonnet-5-5',
    max_tokens: 100,
    system: 'be brief',
    messages: [{ role: 'user', content: 'hello' }],
  });

  const res = await callProxy('POST', '/v1/messages', body, getSessionToken());

  assert.equal(res.status, 200);
  // Upstream: OpenAI chat, routed model, system prompt as the first message
  assert.equal(seen[0].path, '/v1/chat/completions');
  const sent = JSON.parse(seen[0].body);
  assert.equal(sent.model, 'routed-model');
  assert.deepEqual(sent.messages[0], { role: 'system', content: 'be brief' });
  // Client: an Anthropic message
  const answer = JSON.parse(res.body);
  assert.equal(answer.type, 'message');
  assert.equal(answer.content[0].type, 'text');
  assert.equal(answer.content[0].text, 'ok');
  setRouter(undefined);
});

test('translation: a streamed Anthropic request gets Anthropic stream events as the answer arrives', async () => {
  setRouter([{ match: { maxTokens: 2000 }, model: 'routed-model', provider: 'local' }]);
  const url = new URL(getProxyUrl()!);
  const body = JSON.stringify({ model: 'claude-sonnet-5-5', max_tokens: 50, stream: true, messages: [{ role: 'user', content: 'go' }] });

  const received = await new Promise<string>((resolve, reject) => {
    const req = http.request(
      {
        hostname: url.hostname,
        port: Number(url.port),
        path: '/v1/messages',
        method: 'POST',
        headers: {
          'x-tpt-token': getSessionToken()!,
          'content-type': 'application/json',
          'content-length': Buffer.byteLength(body).toString(),
        },
      },
      (res) => {
        let text = '';
        res.on('data', (chunk: Buffer) => {
          text += chunk.toString('utf8');
          // The mock upstream streams forever: stop once the first text delta arrived
          if (text.includes('text_delta')) {
            req.destroy();
            resolve(text);
          }
        });
        res.on('error', () => { /* the destroy below closes the socket */ });
      }
    );
    req.on('error', (e) => {
      if (!String(e).includes('socket hang up') && !String(e).includes('ECONNRESET')) reject(e);
    });
    req.write(body);
    req.end();
  });

  assert.ok(received.includes('event: message_start'));
  assert.ok(received.includes('event: content_block_start'));
  assert.ok(received.includes('"text_delta"'));
  setRouter(undefined);
});

test('allowlist: a path outside the proxied endpoints returns 404 and never reaches the upstream', async () => {
  seen.length = 0;

  const res = await callProxy('GET', '/v1/files', undefined, getSessionToken());

  assert.equal(res.status, 404);
  assert.equal(seen.length, 0);
});
