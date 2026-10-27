import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as path from 'path';
import { isValidEditRange, resolveWorkspaceFile } from '../utils/editSafety';

const root = path.resolve('/workspace/project');

// ── resolveWorkspaceFile ──────────────────────────────────────────────────────

test('resolveWorkspaceFile: normal relative path resolves inside the root', () => {
  assert.equal(resolveWorkspaceFile(root, 'src/index.ts'), path.resolve(root, 'src/index.ts'));
});

test('resolveWorkspaceFile: parent traversal is rejected', () => {
  assert.equal(resolveWorkspaceFile(root, '../../etc/passwd'), undefined);
  assert.equal(resolveWorkspaceFile(root, 'src/../../outside.ts'), undefined);
});

test('resolveWorkspaceFile: absolute paths are rejected', () => {
  assert.equal(resolveWorkspaceFile(root, '/etc/passwd'), undefined);
  assert.equal(resolveWorkspaceFile(root, 'C:\\Windows\\system.ini'), undefined);
});

test('resolveWorkspaceFile: the root itself and empty values are rejected', () => {
  assert.equal(resolveWorkspaceFile(root, '.'), undefined);
  assert.equal(resolveWorkspaceFile(root, ''), undefined);
  assert.equal(resolveWorkspaceFile(root, undefined), undefined);
  assert.equal(resolveWorkspaceFile(root, 42), undefined);
});

test('resolveWorkspaceFile: a name that starts with dots but stays inside is allowed', () => {
  assert.equal(resolveWorkspaceFile(root, '..config/app.json'), path.resolve(root, '..config/app.json'));
});

// ── isValidEditRange ──────────────────────────────────────────────────────────

test('isValidEditRange: a range inside the file is valid', () => {
  assert.equal(isValidEditRange(1, 3, 10), true);
  assert.equal(isValidEditRange(5, 5, 10), true);
});

test('isValidEditRange: zero, negative, reversed and past-EOF starts are rejected', () => {
  assert.equal(isValidEditRange(0, 1, 10), false);
  assert.equal(isValidEditRange(-2, 1, 10), false);
  assert.equal(isValidEditRange(5, 3, 10), false);
  assert.equal(isValidEditRange(11, 12, 10), false);
});

test('isValidEditRange: an end past the last line is rejected, not clamped', () => {
  assert.equal(isValidEditRange(5, 11, 10), false);
  assert.equal(isValidEditRange(1, 10, 10), true);
});

test('isValidEditRange: non-integer line numbers are rejected', () => {
  assert.equal(isValidEditRange(1.5, 3, 10), false);
  assert.equal(isValidEditRange('2', 3, 10), false);
  assert.equal(isValidEditRange(undefined, 3, 10), false);
  assert.equal(isValidEditRange(NaN, 3, 10), false);
});
