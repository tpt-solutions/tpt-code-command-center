import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test, mock } from 'node:test';
import assert from 'node:assert/strict';
import { runTokenShield, storeCachedResponse, TokenShieldConfig } from '../modules/tokenShield';
import { Message } from '../proxy/types';

// No workspace folder is open in tests, so the cache lives in memory and nothing is written to disk.
// Each test uses its own messages, because the cache is shared within this test process.
const config = (maxCacheSizeMB: number): TokenShieldConfig => ({
  enabled: true,
  maxCacheSizeMB,
  semanticCache: { enabled: false, similarityThreshold: 0.92, ollamaModel: 'x', ollamaBaseUrl: 'http://localhost:11434' },
});

const DAY_MS = 24 * 60 * 60 * 1000;

test('token shield store: a stored answer is returned for the same prompt', async () => {
  const messages: Message[] = [{ role: 'user', content: 'store then fetch' }];
  await storeCachedResponse(messages, '{"answer":1}', config(256));
  assert.equal(await runTokenShield(messages, config(256)), '{"answer":1}');
});

test('token shield store: an entry older than 24 hours is a miss', async () => {
  const messages: Message[] = [{ role: 'user', content: 'expires after a day' }];
  const now = Date.now();
  const dateNow = mock.method(Date, 'now', () => now);
  try {
    await storeCachedResponse(messages, 'old answer', config(256));
    dateNow.mock.mockImplementation(() => now + DAY_MS + 1);
    assert.equal(await runTokenShield(messages, config(256)), null);
  } finally {
    dateNow.mock.restore();
  }
});

test('token shield store: an entry just inside 24 hours is still a hit', async () => {
  const messages: Message[] = [{ role: 'user', content: 'still fresh at 23 hours' }];
  const now = Date.now();
  const dateNow = mock.method(Date, 'now', () => now);
  try {
    await storeCachedResponse(messages, 'fresh answer', config(256));
    dateNow.mock.mockImplementation(() => now + DAY_MS - 1000);
    assert.equal(await runTokenShield(messages, config(256)), 'fresh answer');
  } finally {
    dateNow.mock.restore();
  }
});

test('token shield store: over the size cap, the oldest entries are evicted and the newest kept', async () => {
  // A cap of 0.0002 MB is about 210 bytes; each stored answer is 100 bytes
  const cap = config(0.0002);
  const answer = 'x'.repeat(100);
  const prompts: Message[][] = ['evict-a', 'evict-b', 'evict-c'].map((c) => [{ role: 'user', content: c }]);
  const now = Date.now();
  const dateNow = mock.method(Date, 'now', () => now);
  try {
    for (const [i, messages] of prompts.entries()) {
      dateNow.mock.mockImplementation(() => now + i * 1000);
      await storeCachedResponse(messages, answer, cap);
    }
    assert.equal(await runTokenShield(prompts[0], cap), null, 'oldest entry was evicted');
    assert.equal(await runTokenShield(prompts[2], cap), answer, 'newest entry was kept');
  } finally {
    dateNow.mock.restore();
  }
});
