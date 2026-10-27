import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { setStoragePath, recordRequest, flushLedger, clearLedger } from '../ledger/ledger';

const entry = {
  model: 'claude-sonnet-5-5',
  tokensIn: 100,
  tokensOut: 20,
  costUsd: 0.001,
  moduleActions: [],
  cacheHit: false,
};

// Stands in for a second VS Code window: opens the shared file, adds a row, writes it back
async function otherWindowAddsRow(dbPath: string, model: string): Promise<void> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const initSqlJs = require('sql.js');
  const SQL = await initSqlJs();
  const disk = fs.existsSync(dbPath) ? new SQL.Database(fs.readFileSync(dbPath)) : new SQL.Database();
  disk.run(`CREATE TABLE IF NOT EXISTS requests (
    id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, model TEXT NOT NULL,
    tokens_in INTEGER NOT NULL, tokens_out INTEGER NOT NULL, cost_usd REAL NOT NULL,
    cache_hit INTEGER NOT NULL, module_actions TEXT NOT NULL)`);
  disk.run('INSERT INTO requests (ts, model, tokens_in, tokens_out, cost_usd, cache_hit, module_actions) VALUES (?,?,?,?,?,?,?)',
    [Date.now(), model, 1, 1, 0, 0, '']);
  fs.writeFileSync(dbPath, Buffer.from(disk.export()));
  disk.close();
}

function diskModels(dbPath: string): Promise<string[]> {
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  return require('sql.js')().then((SQL: { Database: new (d: Buffer) => { exec: (s: string) => { values: unknown[][] }[]; close: () => void } }) => {
    const disk = new SQL.Database(fs.readFileSync(dbPath));
    const rows = disk.exec('SELECT model FROM requests ORDER BY id')[0]?.values.map((r) => String(r[0])) ?? [];
    disk.close();
    return rows;
  });
}

test('ledger merge: a row another window wrote is kept when this window flushes', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-ledger-merge-'));
  setStoragePath(dir);
  const dbPath = path.join(dir, 'ledger.db');

  await recordRequest({ ...entry, model: 'ours-1' });
  flushLedger();

  await otherWindowAddsRow(dbPath, 'theirs');

  await recordRequest({ ...entry, model: 'ours-2' });
  flushLedger();

  assert.deepEqual(await diskModels(dbPath), ['ours-1', 'theirs', 'ours-2']);
});

test('ledger merge: clearing removes the rows from the file too', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-ledger-clear-'));
  setStoragePath(dir);
  const dbPath = path.join(dir, 'ledger.db');

  await recordRequest({ ...entry, model: 'to-clear' });
  flushLedger();
  await clearLedger();

  assert.deepEqual(await diskModels(dbPath), []);
});
