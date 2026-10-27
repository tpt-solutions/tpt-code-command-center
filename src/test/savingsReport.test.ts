import './helpers/mock-vscode'; // must be first — stubs vscode before any module loads it
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { setStoragePath, recordRequest, flushLedger, getModuleSavings } from '../ledger/ledger';
import { attributeStages, sumModuleSavings, renderSavingsReport, stageLabel } from '../utils/savings';

test('attribution: a stage is charged with the change from the stage before it', () => {
  const effects = attributeStages([
    { stage: 'original', tokens: 1000 },
    { stage: 'vault', tokens: 1000 },
    { stage: 'smartContext', tokens: 600 },
    { stage: 'silentEdit', tokens: 650 },
  ]);
  assert.deepEqual(effects, [
    { stage: 'vault', saved: 0, added: 0 },
    { stage: 'smartContext', saved: 400, added: 0 },
    { stage: 'silentEdit', saved: 0, added: 50 },
  ]);
});

test('sum: effects over many requests are totalled per module, largest saving first', () => {
  const rows = sumModuleSavings([
    [{ stage: 'original', tokens: 100 }, { stage: 'smartContext', tokens: 40 }, { stage: 'silentEdit', tokens: 45 }],
    [{ stage: 'original', tokens: 200 }, { stage: 'smartContext', tokens: 120 }, { stage: 'silentEdit', tokens: 120 }],
  ]);
  assert.deepEqual(rows, [
    { module: 'smartContext', saved: 140, added: 0, requests: 2 },
    { module: 'silentEdit', saved: 0, added: 5, requests: 1 },
  ]);
});

test('sum: no measured requests gives no rows', () => {
  assert.deepEqual(sumModuleSavings([]), []);
});

test('report: module names are shown, figures are stated as estimates, and the net is totalled', () => {
  const report = renderSavingsReport({
    period: '2026-10',
    measuredRequests: 12,
    modules: [
      { module: 'smartContext', saved: 500, added: 0, requests: 9 },
      { module: 'silentEdit', saved: 0, added: 40, requests: 3 },
    ],
  });
  assert.match(report, /# TPT token savings: 2026-10/);
  assert.match(report, /\| Smart Context \| 500 \| 0 \| 9 \|/);
  assert.match(report, /\| Silent Edit \| 0 \| 40 \| 3 \|/);
  assert.match(report, /All figures are estimates/);
  assert.match(report, /Net removed: 460 tokens/);
});

test('report: with nothing measured it still renders a valid table', () => {
  const report = renderSavingsReport({ period: '2026-10', measuredRequests: 0, modules: [] });
  assert.match(report, /\(no changes measured\) \| 0 \| 0 \| 0/);
});

test('stage labels: known stages get their user-facing name, unknown ones pass through', () => {
  assert.equal(stageLabel('memoryWeaver'), 'Memory Weaver');
  assert.equal(stageLabel('translate'), 'Translation');
  assert.equal(stageLabel('somethingNew'), 'somethingNew');
});

test('ledger: per-stage counts are stored with a request and summed by module', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-savings-'));
  setStoragePath(dir);
  await recordRequest({
    model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0, moduleActions: [], cacheHit: false,
    stageTokens: [{ stage: 'original', tokens: 300 }, { stage: 'vault', tokens: 120 }],
  });
  await recordRequest({ model: 'm', tokensIn: 1, tokensOut: 1, costUsd: 0, moduleActions: [], cacheHit: false });
  flushLedger();

  const result = await getModuleSavings(0);
  assert.equal(result.measuredRequests, 1, 'the request without counts is not measured');
  assert.deepEqual(result.modules, [{ module: 'vault', saved: 180, added: 0, requests: 1 }]);
});

test('ledger: a database written before stage counts existed gets the column and keeps working', async () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'tpt-savings-old-'));
  const dbPath = path.join(dir, 'ledger.db');
  // An old-schema ledger, written the way the 0.1.1 extension wrote it
  // eslint-disable-next-line @typescript-eslint/no-var-requires
  const SQL = await require('sql.js')();
  const old = new SQL.Database();
  old.run(`CREATE TABLE requests (id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, model TEXT NOT NULL,
    tokens_in INTEGER NOT NULL, tokens_out INTEGER NOT NULL, cost_usd REAL NOT NULL, cache_hit INTEGER NOT NULL,
    module_actions TEXT NOT NULL)`);
  old.run("INSERT INTO requests (ts, model, tokens_in, tokens_out, cost_usd, cache_hit, module_actions) VALUES (1, 'old', 1, 1, 0, 0, '')");
  fs.writeFileSync(dbPath, Buffer.from(old.export()));
  old.close();

  setStoragePath(dir);
  await recordRequest({
    model: 'new', tokensIn: 1, tokensOut: 1, costUsd: 0, moduleActions: [], cacheHit: false,
    stageTokens: [{ stage: 'original', tokens: 50 }, { stage: 'smartContext', tokens: 10 }],
  });
  flushLedger();

  const check = new SQL.Database(fs.readFileSync(dbPath));
  const columns = check.exec('PRAGMA table_info(requests)')[0].values.map((c: unknown[]) => c[1]);
  assert.ok(columns.includes('stage_tokens'));
  assert.equal(check.exec('SELECT COUNT(*) FROM requests')[0].values[0][0], 2, 'the old row is kept and the new one added');
  check.close();
});
