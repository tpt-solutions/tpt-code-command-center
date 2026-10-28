import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { execFile } from 'child_process';
import { promisify } from 'util';
import { withLedgerLock } from '../ledger/ledger';

const run = promisify(execFile);
const WRITER = path.join(__dirname, 'helpers', 'ledgerWriter.js');
const WINDOWS = 4;
const ROWS = 25;

test('ledger concurrency: rows from windows writing at the same moment are all kept', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-ledger-race-'));
  // Several processes at once, each doing its own read-modify-write of the same file
  await Promise.all(Array.from({ length: WINDOWS }, (_, w) => run(process.execPath, [WRITER, dir, `w${w}`, String(ROWS)])));

  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SQL = await require('sql.js')();
  const disk = new SQL.Database(fs.readFileSync(path.join(dir, 'ledger.db')));
  const count = Number(disk.exec('SELECT COUNT(*) FROM requests')[0].values[0][0]);
  assert.equal(count, WINDOWS * ROWS, 'no window lost its rows to another window');
  assert.equal(fs.existsSync(path.join(dir, 'ledger.db.lock')), false, 'the lock is released afterwards');
});

test('ledger lock: a lock left by a window that died is taken over, and the lock is released after use', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-ledger-stale-'));
  const lock = path.join(dir, 'ledger.db.lock');
  fs.writeFileSync(lock, '');
  const old = new Date(Date.now() - 60_000);
  fs.utimesSync(lock, old, old);

  assert.equal(withLedgerLock(lock, () => 'done'), 'done');
  assert.equal(fs.existsSync(lock), false);
});

test('ledger lock: a fresh lock held by another window is waited for, then reported as not taken', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-ledger-held-'));
  const lock = path.join(dir, 'ledger.db.lock');
  fs.writeFileSync(lock, '');

  const started = Date.now();
  let ran = false;
  assert.equal(withLedgerLock(lock, () => { ran = true; }), undefined);
  assert.equal(ran, false, 'the write does not happen without the lock');
  assert.ok(Date.now() - started >= 4500, 'it waited for the lock before giving up');
  assert.equal(fs.existsSync(lock), true, 'the other window still holds its lock');
});
