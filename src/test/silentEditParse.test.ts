import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { extractEditInstructions } from '../modules/silentEdit';

const fence = '```';

test('extractEditInstructions: a single-line block is parsed', () => {
  const text = `Here you go:\n${fence}tpt-edit\n{"file":"src/a.ts","startLine":1,"endLine":2,"newContent":"x"}\n${fence}\nDone.`;
  const edits = extractEditInstructions(text);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].file, 'src/a.ts');
  assert.equal(edits[0].endLine, 2);
});

test('extractEditInstructions: a triple backtick inside newContent does not close the block early', () => {
  // newContent holds Markdown with its own code fence, escaped as JSON on a single line
  const json = JSON.stringify({ file: 'README.md', startLine: 3, endLine: 3, newContent: 'use ```ts here' });
  const text = `${fence}tpt-edit\n${json}\n${fence}`;
  const edits = extractEditInstructions(text);
  assert.equal(edits.length, 1);
  assert.equal(edits[0].newContent, 'use ```ts here');
});

test('extractEditInstructions: several blocks in one reply are all returned', () => {
  const text = [
    `${fence}tpt-edit\n{"file":"a.ts","startLine":1,"endLine":1,"newContent":"a"}\n${fence}`,
    'between',
    `${fence}tpt-edit\n{"file":"b.ts","startLine":4,"endLine":5,"newContent":"b"}\n${fence}`,
  ].join('\n');
  assert.deepEqual(extractEditInstructions(text).map((e) => e.file), ['a.ts', 'b.ts']);
});

test('extractEditInstructions: invalid JSON and invalid fields are skipped', () => {
  const text = [
    `${fence}tpt-edit\n{not json\n${fence}`,
    `${fence}tpt-edit\n{"file":"c.ts","startLine":"2","endLine":3,"newContent":"c"}\n${fence}`,
    `${fence}tpt-edit\n{"file":"d.ts","startLine":0,"endLine":1,"newContent":42}\n${fence}`,
  ].join('\n');
  assert.deepEqual(extractEditInstructions(text), []);
});

test('extractEditInstructions: text without the fence returns nothing', () => {
  assert.deepEqual(extractEditInstructions('just a normal answer'), []);
});
