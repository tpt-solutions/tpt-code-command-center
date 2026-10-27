import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { setStoragePath, recordRequest, flushLedger } from '../ledger/ledger';

const entry = {
  model: 'claude-sonnet-5-5',
  tokensIn: 100,
  tokensOut: 20,
  costUsd: 0.001,
  moduleActions: [],
  cacheHit: false,
};

test('ledger: rows are written in one batch on flush, not per request', async () => {
  // Own process per test file, so the storage path is set before the database opens
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-ledger-'));
  setStoragePath(dir);
  const dbPath = path.join(dir, 'ledger.db');

  await recordRequest(entry);
  await recordRequest(entry);
  assert.equal(fs.existsSync(dbPath), false, 'no write before the batch is flushed');

  flushLedger();
  assert.equal(fs.existsSync(dbPath), true, 'the flush writes the database');
  const written = fs.statSync(dbPath).mtimeMs;

  // Nothing pending: a second flush must not rewrite the file
  flushLedger();
  assert.equal(fs.statSync(dbPath).mtimeMs, written);
});
