import { test } from 'node:test';
import assert from 'node:assert/strict';
import { tuningSuggestions, MIN_TUNING_SAMPLE } from '../utils/savings';

const sizes = (short: number, long: number): number[] => [
  ...Array(short).fill(500),
  ...Array(long).fill(9000),
];

const on = { memoryEnabled: true, memoryThreshold: 5000, routerEnabled: true };

test('suggestions: nothing is suggested until there are enough measured requests', () => {
  const lines = tuningSuggestions({ originals: sizes(5, 5), memorySummarisedRequests: 0 }, { ...on, routerEnabled: false });
  assert.equal(lines.length, 1);
  assert.match(lines[0], new RegExp(`${MIN_TUNING_SAMPLE} are needed`));
});

test('suggestions: long requests with Memory Weaver off are flagged', () => {
  const lines = tuningSuggestions(
    { originals: sizes(10, 10), memorySummarisedRequests: 0 },
    { memoryEnabled: false, memoryThreshold: 5000, routerEnabled: true },
  );
  assert.ok(lines.some((l) => /Turn on tpt\.memoryWeaver\.enabled/.test(l)));
});

test('suggestions: long requests that are not summarised point at the summariser setup', () => {
  const lines = tuningSuggestions({ originals: sizes(10, 10), memorySummarisedRequests: 2 }, on);
  assert.ok(lines.some((l) => /only 2 were summarised/.test(l) && /fallbackOrder/.test(l)));
});

test('suggestions: when most long requests are summarised, nothing is said about Memory Weaver', () => {
  const lines = tuningSuggestions({ originals: sizes(10, 10), memorySummarisedRequests: 9 }, on);
  assert.ok(!lines.some((l) => /Memory Weaver/.test(l)));
});

test('suggestions: a short-request history suggests trying the router while it is off', () => {
  const lines = tuningSuggestions({ originals: sizes(15, 5), memorySummarisedRequests: 0 }, { ...on, routerEnabled: false });
  assert.ok(lines.some((l) => /75% of requests are at most 2000 tokens/.test(l) && /tpt\.router\.enabled/.test(l)));
});

test('suggestions: with the router on, short requests are not a suggestion', () => {
  const lines = tuningSuggestions({ originals: sizes(15, 5), memorySummarisedRequests: 0 }, on);
  assert.ok(!lines.some((l) => /router/.test(l)));
});

test('suggestions: a history that fits the settings gets an explicit no-change line', () => {
  const lines = tuningSuggestions({ originals: sizes(0, 20).map(() => 800), memorySummarisedRequests: 0 }, on);
  assert.deepEqual(lines, ['No change suggested by the measured requests.']);
});
