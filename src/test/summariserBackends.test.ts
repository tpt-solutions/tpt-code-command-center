import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'http';
import { AddressInfo } from 'net';
import { testConfig } from './helpers/mock-vscode';
import { runMemoryWeaver, MemoryWeaverOptions } from '../modules/memoryWeaver';
import { Message } from '../proxy/types';

// A local stand-in for Ollama (/api/generate) and for an OpenAI-compatible server (/v1/chat/completions).
// It records each request so the tests can tell a fresh summary from a reused one.
interface Fake { port: number; hits: { path: string; body: unknown }[]; close: () => Promise<void> }

function startFake(): Promise<Fake> {
  return new Promise((resolve) => {
    const hits: Fake['hits'] = [];
    const server = http.createServer((req, res) => {
      let raw = '';
      req.on('data', (c: Buffer) => { raw += c.toString(); });
      req.on('end', () => {
        const body = raw ? JSON.parse(raw) : undefined;
        hits.push({ path: req.url ?? '', body });
        res.setHeader('content-type', 'application/json');
        if (req.url === '/api/generate') {
          res.end(JSON.stringify({ response: 'OLLAMA SUMMARY' }));
        } else if (req.url?.endsWith('/chat/completions')) {
          res.end(JSON.stringify({ choices: [{ message: { content: 'PROXY SUMMARY' } }] }));
        } else {
          res.statusCode = 404;
          res.end('{}');
        }
      });
    });
    server.listen(0, 'localhost', () => {
      const { port } = server.address() as AddressInfo;
      resolve({ port, hits, close: () => new Promise((r) => server.close(() => r())) });
    });
  });
}

const options = (fallbackOrder: string[]): MemoryWeaverOptions => ({
  tokenThreshold: 1000,
  fallbackOrder,
  anthropicSummaryModel: 'claude-haiku-4-5-20251001',
  openaiSummaryModel: 'gpt-4o-mini',
  ollamaModel: 'llama3',
});

// Long enough to pass the threshold and to have a block boundary (at 24) to summarise up to
const chat = (tag: string, n = 30): Message[] =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `${tag} ${i} ` + 'w'.repeat(400) }) as Message);

let fake: Fake | undefined;

afterEach(async () => {
  for (const key of Object.keys(testConfig)) delete testConfig[key];
  if (fake) await fake.close();
  fake = undefined;
});

test('summariser: Ollama writes the summary in place of the prefix, with the tail kept', async () => {
  fake = await startFake();
  testConfig['tokenShield.semanticCache.ollamaBaseUrl'] = `http://localhost:${fake.port}`;

  const result = await runMemoryWeaver(chat('ollama-first'), options(['ollama']));

  assert.equal(result.summarised, true);
  assert.equal(fake.hits.length, 1);
  assert.equal(fake.hits[0].path, '/api/generate');
  assert.match(String((result.messages[0] as Message).content), /OLLAMA SUMMARY/);
});

test('summariser: a repeat request with the same prefix reuses the summary and does not call Ollama again', async () => {
  fake = await startFake();
  testConfig['tokenShield.semanticCache.ollamaBaseUrl'] = `http://localhost:${fake.port}`;
  const messages = chat('ollama-reuse');

  await runMemoryWeaver(messages, options(['ollama']));
  const again = await runMemoryWeaver(messages, options(['ollama']));

  assert.equal(fake.hits.length, 1, 'the second request was served from the summary memo');
  assert.match(String((again.messages[0] as Message).content), /OLLAMA SUMMARY/);
});

test('summariser: the proxy backend asks the configured provider and uses its answer', async () => {
  fake = await startFake();
  testConfig['upstreamProvider'] = 'local';
  testConfig['localBaseUrl'] = `http://localhost:${fake.port}/v1`;

  const result = await runMemoryWeaver(chat('proxy-first'), options(['proxy']));

  assert.equal(result.summarised, true);
  assert.equal(fake.hits.length, 1);
  assert.match(fake.hits[0].path, /\/chat\/completions$/);
  assert.match(String((result.messages[0] as Message).content), /PROXY SUMMARY/);
});

test('summariser: when Ollama is unreachable the next backend in the order is used', async () => {
  // Nothing listens on this port, so the Ollama call fails and the extractive backend takes over
  testConfig['tokenShield.semanticCache.ollamaBaseUrl'] = 'http://localhost:1';

  const result = await runMemoryWeaver(chat('fallthrough'), options(['ollama', 'extractive']));

  assert.equal(result.summarised, true);
  assert.match(String((result.messages[0] as Message).content), /earlier messages were summarised/);
});
