import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { csvField } from '../ledger/ledger';

test('csvField: wraps plain text in quotes', () => {
  assert.equal(csvField('claude-sonnet-5-5'), '"claude-sonnet-5-5"');
});

test('csvField: embedded double quotes are doubled, so the row stays intact', () => {
  assert.equal(csvField('say "hi"'), '"say ""hi"""');
});

test('csvField: cells that start with a formula character are neutralised', () => {
  assert.equal(csvField('=HYPERLINK("http://x")'), '"\'=HYPERLINK(""http://x"")"');
  assert.equal(csvField('+1+1'), '"\'+1+1"');
  assert.equal(csvField('@cmd'), '"\'@cmd"');
});

test('csvField: null and undefined become an empty quoted cell', () => {
  assert.equal(csvField(undefined), '""');
  assert.equal(csvField(null), '""');
});
