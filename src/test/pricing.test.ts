import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { priceCost } from '../ledger/pricing';

// Prices are per million tokens, as the pricing table stores them
const plain = { promptPer1M: 3, completionPer1M: 15 };

test('priceCost: without cache rates, cached tokens are billed at the prompt rate', () => {
  // 1M prompt tokens, half of them cache reads: 1M x $3 per 1M
  assert.ok(Math.abs(priceCost(plain, 1_000_000, 0, { read: 500_000 }) - 3) < 1e-9);
});

test('priceCost: cache reads are billed at the cache read rate', () => {
  const price = { ...plain, cacheReadPer1M: 0.3 };
  // 500k plain at $3 + 500k read at $0.30
  assert.ok(Math.abs(priceCost(price, 1_000_000, 0, { read: 500_000 }) - 1.65) < 1e-9);
});

test('priceCost: cache writes are billed at the cache write rate', () => {
  const price = { ...plain, cacheWritePer1M: 3.75 };
  // 900k plain at $3 + 100k written at $3.75
  assert.ok(Math.abs(priceCost(price, 1_000_000, 0, { write: 100_000 }) - 3.075) < 1e-9);
});

test('priceCost: output tokens are added at the completion rate', () => {
  assert.ok(Math.abs(priceCost(plain, 0, 1_000_000) - 15) < 1e-9);
});

test('priceCost: cache counts larger than the prompt are clamped, never negative', () => {
  const price = { ...plain, cacheReadPer1M: 0.3 };
  const cost = priceCost(price, 1_000, 0, { read: 5_000 });
  assert.ok(cost >= 0);
  assert.ok(Math.abs(cost - (5_000 * 0.3) / 1_000_000) < 1e-12);
});
