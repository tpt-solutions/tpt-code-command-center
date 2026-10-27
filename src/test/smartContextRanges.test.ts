import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSmartContext } from '../modules/smartContext';
import { Message } from '../proxy/types';

const big = Array.from({ length: 30_000 }, (_, i) => `export function f${i}() {}`).join('\n');

function readTurn(input: Record<string, unknown>): Message[] {
  return [
    { role: 'assistant', content: [{ type: 'tool_use', id: 'c1', name: 'Read', input }] } as unknown as Message,
    { role: 'user', content: [{ type: 'tool_result', tool_use_id: 'c1', content: big }] } as unknown as Message,
  ];
}

test('smart context: a whole-file read is outlined', async () => {
  const result = await runSmartContext(readTurn({ file_path: 'src/app.ts' }), 512_000);
  assert.equal(result.replaced, 1);
});

test('smart context: a ranged read (offset and limit) is passed through intact', async () => {
  const result = await runSmartContext(readTurn({ file_path: 'src/app.ts', offset: 100, limit: 50 }), 512_000);
  assert.equal(result.replaced, 0);
  const block = (result.messages[1].content as Array<Record<string, unknown>>)[0];
  assert.equal(block.content, big);
});

test('smart context: a ranged read given as line numbers is also passed through', async () => {
  const result = await runSmartContext(readTurn({ path: 'src/app.ts', start_line: 10, end_line: 40 }), 512_000);
  assert.equal(result.replaced, 0);
});
