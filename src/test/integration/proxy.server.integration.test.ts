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
}

const seen: Seen[] = [];
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
      seen.push({ method: req.method ?? '', path: req.url ?? '', body: Buffer.concat(chunks).toString('utf8') });
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

test('allowlist: a path outside the proxied endpoints returns 404 and never reaches the upstream', async () => {
  seen.length = 0;

  const res = await callProxy('GET', '/v1/files', undefined, getSessionToken());

  assert.equal(res.status, 404);
  assert.equal(seen.length, 0);
});
