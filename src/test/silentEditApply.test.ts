import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { testWorkspace, FakeWorkspaceEdit } from './helpers/mock-vscode';
import { applyEdits, SilentEditInstruction } from '../modules/silentEdit';

const ROOT = path.resolve('/ws/project');
const FIVE_LINES = 5;

// The workspace the edits land in. Each document has five lines; the last line is ten characters long.
let applied: FakeWorkspaceEdit[] = [];
let applyResult = true;
let openable = true;

beforeEach(() => {
  applied = [];
  applyResult = true;
  openable = true;
  testWorkspace.workspaceFolders = [{ uri: { fsPath: ROOT } }];
  testWorkspace.openTextDocument = async () => {
    if (!openable) throw new Error('no such file');
    return {
      lineCount: FIVE_LINES,
      lineAt: () => ({ range: { end: { character: 10 } } }),
    };
  };
  testWorkspace.applyEdit = async (edit) => {
    applied.push(edit);
    return applyResult;
  };
});

const edit = (overrides: Partial<SilentEditInstruction> = {}): SilentEditInstruction => ({
  file: 'src/a.ts',
  startLine: 2,
  endLine: 3,
  newContent: 'replacement',
  ...overrides,
});

test('silent edit apply: a valid instruction becomes a replace of its line range', async () => {
  await applyEdits([edit()]);

  assert.equal(applied.length, 1);
  assert.equal(applied[0].replaces.length, 1);
  const [r] = applied[0].replaces;
  assert.equal(r.uri, path.join(ROOT, 'src', 'a.ts'));
  // Lines are 1-indexed in the instruction and 0-indexed in VS Code, and the range ends at the line's last character
  assert.deepEqual([r.range.startLine, r.range.startChar, r.range.endLine, r.range.endChar], [1, 0, 2, 10]);
  assert.equal(r.text, 'replacement');
});

test('silent edit apply: a path outside the workspace is refused, and nothing is replaced', async () => {
  await applyEdits([edit({ file: '../../etc/passwd' })]);

  assert.equal(applied.length, 1);
  assert.equal(applied[0].replaces.length, 0);
});

test('silent edit apply: a range past the end of the file is skipped', async () => {
  await applyEdits([edit({ startLine: 2, endLine: 99 })]);

  assert.equal(applied[0].replaces.length, 0);
});

test('silent edit apply: a file that cannot be opened is skipped', async () => {
  openable = false;
  await applyEdits([edit()]);

  assert.equal(applied[0].replaces.length, 0);
});

test('silent edit apply: VS Code rejecting the batch is logged, not thrown', async () => {
  applyResult = false;
  await applyEdits([edit()]);

  assert.equal(applied.length, 1);
});

test('silent edit apply: with no workspace folder open, nothing is applied', async () => {
  testWorkspace.workspaceFolders = undefined;
  await applyEdits([edit()]);

  assert.equal(applied.length, 0);
});
