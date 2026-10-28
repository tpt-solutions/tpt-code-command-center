import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import * as http from 'http';
import * as net from 'net';
import { runTokenShield, storeCachedResponse, TokenShieldConfig } from '../modules/tokenShield';
import { Message } from '../proxy/types';

// A fake Ollama: an embedding is [1, 0] for text about deploying and [0, 1] for anything else,
// so a prompt with different wording but the same topic is similar, and an unrelated one is not.
let server: http.Server;
let port: number;

before(async () => {
  port = await new Promise<number>((resolve, reject) => {
    const probe = net.createServer();
    probe.listen(0, '127.0.0.1', () => {
      const addr = probe.address() as net.AddressInfo;
      probe.close(() => resolve(addr.port));
    });
    probe.on('error', reject);
  });
  server = http.createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => chunks.push(c));
    req.on('end', () => {
      const { prompt } = JSON.parse(Buffer.concat(chunks).toString('utf8')) as { prompt: string };
      const embedding = prompt.includes('deploy') ? [1, 0] : [0, 1];
      res.writeHead(200, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ embedding }));
    });
  });
  await new Promise<void>((resolve) => server.listen(port, '127.0.0.1', resolve));
});

after(() => {
  server.close();
});

const semantic = (similarityThreshold = 0.92): TokenShieldConfig => ({
  enabled: true,
  maxCacheSizeMB: 256,
  semanticCache: { enabled: true, similarityThreshold, ollamaModel: 'nomic-embed-text', ollamaBaseUrl: `http://localhost:${port}` },
});

// Embeddings are stored in the background after the answer is returned, so the lookup waits for them
async function lookupWhenStored(messages: Message[], cfg: TokenShieldConfig): Promise<string | null> {
  const deadline = Date.now() + 2000;
  let hit: string | null = null;
  while (!hit && Date.now() < deadline) {
    hit = await runTokenShield(messages, cfg);
    if (!hit) await new Promise((r) => setTimeout(r, 20));
  }
  return hit;
}

test('semantic cache: a differently worded prompt on the same topic gets the stored answer', async () => {
  const cfg = semantic();
  await storeCachedResponse([{ role: 'user', content: 'how do I deploy the app to staging' }], 'answer-deploy', cfg);

  const similar = [{ role: 'user', content: 'what are the steps to deploy this application' } as Message];
  assert.equal(await lookupWhenStored(similar, cfg), 'answer-deploy');
});

test('semantic cache: an unrelated prompt does not match, and nothing is returned for it', async () => {
  const cfg = semantic();
  await storeCachedResponse([{ role: 'user', content: 'how do I deploy the app to staging' }], 'answer-deploy-2', cfg);

  const unrelated: Message[] = [{ role: 'user', content: 'explain the history of the roman empire' }];
  assert.equal(await runTokenShield(unrelated, cfg), null);
});

test('semantic cache: a match below the similarity threshold is not returned', async () => {
  // Vectors [1,0] and [0,1] have cosine 0, so no threshold above 0 can be met by an unrelated prompt;
  // a threshold of 1 also rejects a near-match, since only identical directions score 1
  const cfg = semantic(1.01);
  await storeCachedResponse([{ role: 'user', content: 'how do I deploy the app to production' }], 'answer-strict', cfg);

  const similar: Message[] = [{ role: 'user', content: 'deploy steps please' }];
  assert.equal(await runTokenShield(similar, cfg), null);
});

test('semantic cache: when Ollama is unreachable, the lookup is a miss and the request is not blocked', async () => {
  const cfg = semantic();
  cfg.semanticCache.ollamaBaseUrl = 'http://localhost:1'; // nothing listens here
  const messages: Message[] = [{ role: 'user', content: 'deploy with nothing listening' }];
  assert.equal(await runTokenShield(messages, cfg), null);
});
