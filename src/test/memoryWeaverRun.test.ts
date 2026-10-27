import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runMemoryWeaver, summaryBoundary, SUMMARY_BLOCK, MemoryWeaverOptions } from '../modules/memoryWeaver';
import { Message } from '../proxy/types';

const options = (overrides: Partial<MemoryWeaverOptions> = {}): MemoryWeaverOptions => ({
  tokenThreshold: 1000,
  fallbackOrder: ['extractive'],
  anthropicSummaryModel: 'claude-haiku-4-5-20251001',
  openaiSummaryModel: 'gpt-4o-mini',
  ollamaModel: 'llama3',
  ...overrides,
});

// 400 characters is about 100 tokens
const chat = (n: number): Message[] =>
  Array.from({ length: n }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `turn ${i} ` + 'w'.repeat(400) }) as Message);

test('memory weaver: a conversation under the threshold is returned unchanged', async () => {
  const messages = chat(4);
  const result = await runMemoryWeaver(messages, options({ tokenThreshold: 100000 }));
  assert.equal(result.summarised, false);
  assert.equal(result.messages, messages);
});

test('memory weaver: extractive summarisation keeps the system prompt and the newest messages', async () => {
  const system: Message = { role: 'system', content: 'be helpful' };
  const messages = [system, ...chat(30)];
  const result = await runMemoryWeaver(messages, options({ tokenThreshold: 1000 }));

  assert.equal(result.summarised, true);
  assert.deepEqual(result.messages[0], system);
  // The marker says how many earlier messages were dropped
  assert.match(String((result.messages[1] as Message).content), /earlier messages were summarised/);
  // The last message of the conversation survives
  assert.equal(result.messages[result.messages.length - 1], messages[messages.length - 1]);
  assert.ok(result.messages.length < messages.length);
});

test('memory weaver: extractive summarisation keeps the messages within 60% of the threshold', async () => {
  const messages = chat(30);
  const result = await runMemoryWeaver(messages, options({ tokenThreshold: 1000 }));
  const kept = result.messages.filter((m) => !String(m.content).startsWith('[TPT Memory Weaver:'));
  const keptChars = kept.reduce((n, m) => n + String(m.content).length, 0);
  assert.ok(keptChars <= 1000 * 4 * 0.6, `kept ${keptChars} chars`);
});

test('memory weaver: the summarised prefix stays the same for a whole block of turns', () => {
  // As the conversation grows one message at a time, the boundary only moves once per block
  const boundaries = Array.from({ length: 40 }, (_, i) => summaryBoundary(chat(i + 12)));
  for (let i = 1; i < boundaries.length; i++) {
    assert.ok(boundaries[i] === boundaries[i - 1] || boundaries[i] - boundaries[i - 1] === SUMMARY_BLOCK,
      `boundary jumped from ${boundaries[i - 1]} to ${boundaries[i]} at length ${i + 12}`);
  }
  // A block boundary keeps at least four messages after it
  for (let n = 12; n < 52; n++) {
    const b = summaryBoundary(chat(n));
    assert.equal(b % SUMMARY_BLOCK, 0);
    assert.ok(n - b >= 4);
  }
});

test('memory weaver: nothing is summarised before the first block boundary', () => {
  assert.equal(summaryBoundary(chat(10)), 0);
});

test('memory weaver: a summary boundary never starts the tail on a tool result', () => {
  const toolResult = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't', content: 'r' }] } as unknown as Message;
  const conv = chat(20);
  conv[16] = toolResult; // the block boundary for 20 messages is 16, which would start on this result
  const b = summaryBoundary(conv);
  assert.ok(b < 16, `boundary ${b} should move back before the tool result`);
});

test('memory weaver: unknown backend names are ignored and the conversation is left as it is', async () => {
  const messages = chat(30);
  const result = await runMemoryWeaver(messages, options({ fallbackOrder: ['carrier-pigeon'] }));
  assert.equal(result.summarised, false);
  assert.equal(result.messages, messages);
});

test('memory weaver: an extractive window never starts on a tool result', async () => {
  // Sized so the newest messages fit the window up to the tool result, but not the tool_use before it.
  // The window must then move back to include the tool_use.
  const toolUse = { role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input: { path: 'x'.repeat(480) } }] } as unknown as Message;
  const toolResult = { role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content: 'w'.repeat(1000) }] } as unknown as Message;
  const messages: Message[] = [...chat(10), toolUse, toolResult, { role: 'assistant', content: 'd'.repeat(500) } as Message];
  const result = await runMemoryWeaver(messages, options({ tokenThreshold: 800 }));
  const first = result.messages.find((m) => !String(m.content).startsWith('[TPT Memory Weaver:'));
  assert.ok(first, 'window is not empty');
  assert.ok(Array.isArray(first!.content));
  assert.equal((first!.content as unknown as Array<{ type: string }>)[0].type, 'tool_use');
});
