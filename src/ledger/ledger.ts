import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';
import { AnthropicRequest, OpenAIRequest } from '../proxy/types';
import type { Database } from 'sql.js';
import { log } from '../utils/logger';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let initSqlJs: (config?: any) => Promise<any>;
let db: Database | undefined;

let _onRecord: (() => void) | undefined;
export function setOnRecordHook(fn: () => void): void { _onRecord = fn; }

let _storageUri: string | undefined;
export function setStoragePath(uri: string): void { _storageUri = uri; }

let dbReady: Promise<Database> | undefined;

// Shared promise so concurrent first requests don't each open (and overwrite) the database
function getDb(): Promise<Database> {
  if (!dbReady) {
    dbReady = openDb().catch((e) => {
      dbReady = undefined;
      throw e;
    });
  }
  return dbReady;
}

async function openDb(): Promise<Database> {
  if (db) return db;

  if (!initSqlJs) {
    initSqlJs = require('sql.js');
  }

  const SQL = await initSqlJs({
    locateFile: (file: string) => path.join(__dirname, '..', '..', 'node_modules', 'sql.js', 'dist', file),
  });

  const tptDir = getTptDir();
  if (!tptDir) {
    db = new SQL.Database();
  } else {
    const dbPath = path.join(tptDir, 'ledger.db');
    if (fs.existsSync(dbPath)) {
      const data = fs.readFileSync(dbPath);
      db = new SQL.Database(data);
    } else {
      db = new SQL.Database();
    }
  }

  db!.run(`
    CREATE TABLE IF NOT EXISTS requests (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      ts INTEGER NOT NULL,
      model TEXT NOT NULL,
      tokens_in INTEGER NOT NULL,
      tokens_out INTEGER NOT NULL,
      cost_usd REAL NOT NULL,
      cache_hit INTEGER NOT NULL,
      module_actions TEXT NOT NULL
    )
  `);

  return db!;
}

// Returns undefined (and the ledger stays in memory) when the folder cannot be created,
// for example a read-only or virtual workspace; requests must still be served.
function ensureDir(dir: string): string | undefined {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return undefined;
  }
}

function getTptDir(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (folders?.length) {
    return ensureDir(path.join(folders[0].uri.fsPath, '.tpt'));
  }
  if (_storageUri) {
    return ensureDir(_storageUri);
  }
  return undefined;
}

// Writes to a temp file and renames it into place, so a crash mid-write cannot leave a
// truncated ledger behind
// Writing the whole database is expensive, so recordRequest marks it dirty and one write
// happens shortly after. flushLedger writes immediately (used on deactivate).
const PERSIST_DELAY_MS = 1000;
let persistTimer: ReturnType<typeof setTimeout> | undefined;
let persistPending = false;

function schedulePersist(): void {
  persistPending = true;
  if (persistTimer) return;
  persistTimer = setTimeout(() => {
    persistTimer = undefined;
    flushLedger();
  }, PERSIST_DELAY_MS);
  persistTimer.unref();
}

export function flushLedger(): void {
  if (persistTimer) {
    clearTimeout(persistTimer);
    persistTimer = undefined;
  }
  if (!persistPending) return;
  persistPending = false;
  persistDb();
}

function persistDb(): void {
  if (!db) return;
  const tptDir = getTptDir();
  if (!tptDir) return;
  const dbPath = path.join(tptDir, 'ledger.db');
  const tmpPath = `${dbPath}.tmp`;
  try {
    fs.writeFileSync(tmpPath, Buffer.from(db.export()));
    fs.renameSync(tmpPath, dbPath);
  } catch (e) {
    // Persisting is best-effort; the in-memory ledger keeps counting
    log(`Ledger: could not persist ${dbPath}: ${e}`);
  }
}

export interface LedgerEntry {
  model: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  moduleActions: string[];
  cacheHit: boolean;
}

export async function recordRequest(entry: LedgerEntry): Promise<void> {
  const database = await getDb();
  database.run(
    'INSERT INTO requests (ts, model, tokens_in, tokens_out, cost_usd, cache_hit, module_actions) VALUES (?,?,?,?,?,?,?)',
    [Date.now(), entry.model, entry.tokensIn, entry.tokensOut, entry.costUsd, entry.cacheHit ? 1 : 0, entry.moduleActions.join(',')]
  );
  schedulePersist();
  _onRecord?.();
}

export interface LedgerStats {
  totalRequests: number;
  totalTokensIn: number;
  totalTokensOut: number;
  totalCostUsd: number;
  cacheHits: number;
  estimatedSavingsUsd: number;
  tokensSaved: number;
  thisMonthCostUsd: number;
  last7Days: DayStat[];
}

export interface DayStat {
  date: string;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  cacheHits: number;
}

export async function getStats(): Promise<LedgerStats> {
  const database = await getDb();

  const totals = database.exec(
    'SELECT COUNT(*), SUM(tokens_in), SUM(tokens_out), SUM(cost_usd), SUM(cache_hit) FROM requests'
  );
  const row = totals[0]?.values[0] ?? [0, 0, 0, 0, 0];
  const totalRequests = Number(row[0]);
  const totalTokensIn = Number(row[1]);
  const totalTokensOut = Number(row[2]);
  const totalCostUsd = Number(row[3]);
  const cacheHits = Number(row[4]);

  const avgCost = totalRequests > 0 ? totalCostUsd / totalRequests : 0;
  const avgTokensIn = totalRequests > 0 ? totalTokensIn / totalRequests : 0;
  const estimatedSavingsUsd = cacheHits * avgCost;
  const tokensSaved = Math.round(cacheHits * avgTokensIn);

  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const monthRows = database.exec(
    'SELECT COALESCE(SUM(cost_usd), 0) FROM requests WHERE ts >= ?',
    [startOfMonth.getTime()]
  );
  const thisMonthCostUsd = Number(monthRows[0]?.values[0]?.[0] ?? 0);

  const sevenDaysAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const daily = database.exec(
    `SELECT date(ts/1000,'unixepoch','localtime') as d, SUM(tokens_in), SUM(tokens_out), SUM(cost_usd), SUM(cache_hit)
     FROM requests WHERE ts > ? GROUP BY d ORDER BY d`,
    [sevenDaysAgo]
  );

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const last7Days: DayStat[] = (daily[0]?.values ?? []).map((r: any) => ({
    date: String(r[0]),
    tokensIn: Number(r[1]),
    tokensOut: Number(r[2]),
    costUsd: Number(r[3]),
    cacheHits: Number(r[4]),
  }));

  return { totalRequests, totalTokensIn, totalTokensOut, totalCostUsd, cacheHits, estimatedSavingsUsd, tokensSaved, thisMonthCostUsd, last7Days };
}

export interface ModelStat {
  model: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
}

export async function getModelBreakdown(): Promise<ModelStat[]> {
  const database = await getDb();
  const rows = database.exec(
    `SELECT model, COUNT(*), SUM(tokens_in), SUM(tokens_out), SUM(cost_usd)
     FROM requests GROUP BY model ORDER BY SUM(cost_usd) DESC LIMIT 20`
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (rows[0]?.values ?? []).map((r: any) => ({
    model: String(r[0]),
    requests: Number(r[1]),
    tokensIn: Number(r[2]),
    tokensOut: Number(r[3]),
    costUsd: Number(r[4]),
  }));
}

export async function getTodayCostUsd(): Promise<number> {
  const database = await getDb();
  const startOfDay = new Date();
  startOfDay.setHours(0, 0, 0, 0);
  const rows = database.exec(
    'SELECT COALESCE(SUM(cost_usd), 0) FROM requests WHERE ts >= ?',
    [startOfDay.getTime()]
  );
  return Number(rows[0]?.values[0]?.[0] ?? 0);
}

export async function getThisMonthCostUsd(): Promise<number> {
  const database = await getDb();
  const startOfMonth = new Date();
  startOfMonth.setDate(1);
  startOfMonth.setHours(0, 0, 0, 0);
  const rows = database.exec(
    'SELECT COALESCE(SUM(cost_usd), 0) FROM requests WHERE ts >= ?',
    [startOfMonth.getTime()]
  );
  return Number(rows[0]?.values[0]?.[0] ?? 0);
}

export interface MonthStat {
  month: string;
  requests: number;
  tokensIn: number;
  tokensOut: number;
  costUsd: number;
  cacheHits: number;
  savedUsd: number;
  tokensSaved: number;
}

export async function getMonthlyStats(months = 12): Promise<MonthStat[]> {
  const database = await getDb();
  const cutoff = Date.now() - months * 31 * 24 * 60 * 60 * 1000;
  const rows = database.exec(
    `SELECT
       strftime('%Y-%m', ts/1000, 'unixepoch', 'localtime') as m,
       SUM(tokens_in), SUM(tokens_out), SUM(cost_usd),
       SUM(cache_hit), COUNT(*),
       -- Averages are over real upstream calls only: cache hits cost 0 and would drag the
       -- average down. REAL division avoids SQLite truncating integer averages.
       CASE WHEN COUNT(*) - SUM(cache_hit) > 0
         THEN SUM(cost_usd) / CAST(COUNT(*) - SUM(cache_hit) AS REAL) ELSE 0 END as avg_cost,
       CASE WHEN COUNT(*) - SUM(cache_hit) > 0
         THEN CAST(SUM(CASE WHEN cache_hit = 0 THEN tokens_in ELSE 0 END) AS REAL)
              / CAST(COUNT(*) - SUM(cache_hit) AS REAL) ELSE 0 END as avg_tok_in
     FROM requests WHERE ts >= ?
     GROUP BY m ORDER BY m DESC LIMIT ?`,
    [cutoff, months]
  );
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return (rows[0]?.values ?? []).map((r: any) => {
    const hits = Number(r[4]);
    const avgCost = Number(r[6]);
    const avgTokIn = Number(r[7]);
    return {
      month: String(r[0]),
      requests: Number(r[5]),
      tokensIn: Number(r[1]),
      tokensOut: Number(r[2]),
      costUsd: Number(r[3]),
      cacheHits: hits,
      savedUsd: hits * avgCost,
      tokensSaved: Math.round(hits * avgTokIn),
    };
  });
}

export async function clearLedger(): Promise<void> {
  const database = await getDb();
  database.run('DELETE FROM requests');
  persistDb();
}

// Quotes a text field for CSV. Cells starting with = + - @ are prefixed with ' so that
// spreadsheet apps don't evaluate them as formulas (model names and module actions are
// not fully trusted content).
export function csvField(value: unknown): string {
  let s = String(value ?? '');
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return `"${s.replace(/"/g, '""')}"`;
}

export async function exportLedgerCsv(): Promise<string> {
  const database = await getDb();
  const rows = database.exec(
    `SELECT ts, model, tokens_in, tokens_out, cost_usd, cache_hit, module_actions
     FROM requests ORDER BY ts ASC`
  );
  const header = 'timestamp,date,model,tokens_in,tokens_out,cost_usd,cache_hit,module_actions\n';
  const lines = (rows[0]?.values ?? []).map((r) => {
    const ts = Number(r[0]);
    const date = new Date(ts).toISOString();
    return [ts, date, csvField(r[1]), r[2], r[3], Number(r[4]).toFixed(8), r[5], csvField(r[6])].join(',');
  });
  return header + lines.join('\n');
}

export function countTokens(body: AnthropicRequest | OpenAIRequest): number {
  let chars = 0;
  if ('messages' in body && Array.isArray(body.messages)) {
    for (const msg of body.messages) {
      if (typeof msg.content === 'string') {
        chars += msg.content.length;
      } else if (Array.isArray(msg.content)) {
        for (const block of msg.content) {
          if (typeof block === 'object' && block !== null && 'text' in block) {
            chars += String((block as { text?: unknown }).text ?? '').length;
          }
        }
      }
    }
  }
  if ('system' in body && body.system) {
    chars += typeof body.system === 'string' ? body.system.length : JSON.stringify(body.system).length;
  }
  return Math.ceil(chars / 4);
}
