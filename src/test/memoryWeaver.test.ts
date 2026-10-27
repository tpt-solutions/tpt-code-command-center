import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pairSafeTail, runMemoryWeaver } from '../modules/memoryWeaver';
import { Message } from '../proxy/types';

const toolUse = (input: unknown): Message =>
  ({ role: 'assistant', content: [{ type: 'tool_use', id: 't1', name: 'Read', input }] } as never);
const toolResult = (content: string): Message =>
  ({ role: 'user', content: [{ type: 'tool_result', tool_use_id: 't1', content }] } as never);

test('pairSafeTail: a tail that would start on a tool result also keeps its tool_use', () => {
  const conv: Message[] = [
    { role: 'user', content: 'a' },
    toolUse({ path: 'x' }),        // index 1
    toolResult('result'),          // index 2
    { role: 'assistant', content: 'done' },
    { role: 'user', content: 'b' },
  ];
  // Last 3 would start at index 2 (a tool result): must move back to the tool_use
  const tail = pairSafeTail(conv, 3);
  assert.equal(tail.length, 4);
  assert.equal((tail[0].content as unknown as Array<{ type: string }>)[0].type, 'tool_use');
});

test('pairSafeTail: a tail that starts on a normal message is unchanged', () => {
  const conv: Message[] = [
    { role: 'user', content: 'a' },
    toolUse({}),
    toolResult('r'),
    { role: 'assistant', content: 'x' },
    { role: 'user', content: 'y' },
    { role: 'assistant', content: 'z' },
  ];
  assert.deepEqual(pairSafeTail(conv, 2), conv.slice(4));
});

test('pairSafeTail: parallel OpenAI tool messages are kept together with their assistant turn', () => {
  const conv: Message[] = [
    { role: 'user', content: 'a' },
    { role: 'assistant', content: null, tool_calls: [{ id: '1' }, { id: '2' }] } as unknown as Message,
    { role: 'tool', content: 'r1', tool_call_id: '1' } as unknown as Message,
    { role: 'tool', content: 'r2', tool_call_id: '2' } as unknown as Message,
  ];
  const tail = pairSafeTail(conv, 2);
  assert.equal(tail[0].role, 'assistant');
  assert.equal(tail.length, 3);
});

test('extractive summarisation never starts the kept window with an orphaned tool result', async () => {
  const messages: Message[] = [
    { role: 'user', content: 'x'.repeat(400) },
    toolUse({ p: 'y'.repeat(300) }),   // too large to keep
    toolResult('ok'),
    { role: 'assistant', content: 'ok' },
    { role: 'user', content: 'final' },
  ];
  const result = await runMemoryWeaver(messages, {
    tokenThreshold: 100,
    fallbackOrder: ['extractive'],
    anthropicSummaryModel: '',
    openaiSummaryModel: '',
    ollamaModel: '',
  });
  assert.equal(result.summarised, true);
  const idx = result.messages.findIndex((m) =>
    Array.isArray(m.content) && (m.content as Array<{ type: string }>).some((b) => b.type === 'tool_result'));
  assert.ok(idx > 0, 'tool result should be kept');
  const prev = result.messages[idx - 1];
  assert.ok(
    Array.isArray(prev.content) && (prev.content as Array<{ type: string }>).some((b) => b.type === 'tool_use'),
    'the tool_use that issued the result must precede it'
  );
});
