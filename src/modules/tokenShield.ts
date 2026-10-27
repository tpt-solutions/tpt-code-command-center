import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as vscode from 'vscode';
import { hashPrompt } from '../utils/hash';
import { validateUserSuppliedUrl } from '../utils/config';
import { Message } from '../proxy/types';
import type { Database } from 'sql.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
let initSqlJs: (config?: any) => Promise<any>;
let db: Database | undefined;
let dbReady: Promise<Database> | undefined;

// Cached responses older than this are treated as misses (stale answers to repeated prompts)
const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

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
  const dbPath = tptDir ? path.join(tptDir, 'cache.db') : undefined;

  if (dbPath && fs.existsSync(dbPath)) {
    const data = fs.readFileSync(dbPath);
    db = new SQL.Database(data);
  } else {
    db = new SQL.Database();
  }

  db!.run(`
    CREATE TABLE IF NOT EXISTS cache (
      hash TEXT PRIMARY KEY,
      response TEXT NOT NULL,
      ts INTEGER NOT NULL,
      size INTEGER NOT NULL
    )
  `);

  // Semantic cache table: stores embedding as JSON-serialised float array
  db!.run(`
    CREATE TABLE IF NOT EXISTS embeddings (
      hash TEXT PRIMARY KEY,
      embedding TEXT NOT NULL,
      response TEXT NOT NULL,
      ts INTEGER NOT NULL,
      size INTEGER NOT NULL
    )
  `);

  return db!;
}

function getTptDir(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return undefined;
  const dir = path.join(folders[0].uri.fsPath, '.tpt');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

function persistDb(): void {
  if (!db) return;
  const tptDir = getTptDir();
  if (!tptDir) return;
  const data = db.export();
  fs.writeFileSync(path.join(tptDir, 'cache.db'), Buffer.from(data));
}

// ── Exact-match cache ────────────────────────────────────────────────────────

export interface TokenShieldConfig {
  enabled: boolean;
  maxCacheSizeMB: number;
  semanticCache: {
    enabled: boolean;
    similarityThreshold: number;
    ollamaModel: string;
    ollamaBaseUrl: string;
  };
}

export async function runTokenShield(
  messages: Message[],
  config: TokenShieldConfig,
  scope: Record<string, unknown> = {}
): Promise<string | null> {
  const hash = hashPrompt(messages, scope);
  const database = await getDb();

  // 1. Exact hash match (entries past the TTL are ignored)
  const result = database.exec('SELECT response, ts FROM cache WHERE hash = ?', [hash]);
  const row = result[0]?.values[0];
  if (row && Date.now() - Number(row[1]) < CACHE_TTL_MS) {
    return row[0] as string;
  }

  // 2. Semantic match (opt-in, requires Ollama)
  if (config.semanticCache.enabled) {
    const semanticHit = await semanticLookup(messages, database, config.semanticCache);
    if (semanticHit) return semanticHit;
  }

  return null;
}

export async function storeCachedResponse(
  messages: Message[],
  response: string,
  config: TokenShieldConfig,
  scope: Record<string, unknown> = {}
): Promise<void> {
  const hash = hashPrompt(messages, scope);
  const database = await getDb();
  const size = Buffer.byteLength(response);
  const maxCacheSizeMB = config.maxCacheSizeMB;

  database.run(
    'INSERT OR REPLACE INTO cache (hash, response, ts, size) VALUES (?,?,?,?)',
    [hash, response, Date.now(), size]
  );

  // Enforce size cap — evict oldest 10% when over limit
  const maxBytes = maxCacheSizeMB * 1024 * 1024;
  const totalResult = database.exec('SELECT SUM(size) FROM cache');
  const totalSize = Number(totalResult[0]?.values[0]?.[0] ?? 0);

  if (totalSize > maxBytes) {
    database.run(`
      DELETE FROM cache WHERE hash IN (
        SELECT hash FROM cache ORDER BY ts ASC LIMIT MAX(0, (
          SELECT COUNT(*) FROM cache
        ) - (
          SELECT COUNT(*) FROM (
            SELECT hash, SUM(size) OVER (ORDER BY ts DESC) AS running FROM cache
          ) WHERE running <= ?
        ))
      )
    `, [maxBytes * 0.9]);
  }

  // Also store embedding for semantic cache
  if (config.semanticCache.enabled) {
    storeEmbedding(messages, response, database, config.semanticCache, maxBytes, scope).catch(() => { /* non-fatal */ });
  }

  persistDb();
}

// Everything besides the messages that changes what the upstream returns.
// Used as part of the cache key so identical messages sent to a different model,
// system prompt, tool set or API format never receive each other's response.
export function buildCacheScope(body: Record<string, unknown>, format: 'anthropic' | 'openai'): Record<string, unknown> {
  return {
    format,
    model: body.model,
    system: body.system,
    tools: body.tools,
    tool_choice: body.tool_choice,
    temperature: body.temperature,
    max_tokens: body.max_tokens,
  };
}

// A response that asks the client to run a tool is tied to that turn; replaying it
// would hand a stale tool call to a later request, so these are never cached.
export function responseHasToolCall(responseBody: string): boolean {
  return /"type"\s*:\s*"tool_use"/.test(responseBody) || /"tool_calls"\s*:/.test(responseBody);
}

export async function clearCache(): Promise<void> {
  const database = await getDb();
  database.run('DELETE FROM cache');
  database.run('DELETE FROM embeddings');
  persistDb();
}

// ── Semantic cache (Ollama embeddings) ───────────────────────────────────────

interface SemanticConfig {
  enabled: boolean;
  similarityThreshold: number;
  ollamaModel: string;
  ollamaBaseUrl: string;
}

function messagesText(messages: Message[]): string {
  return messages
    .map((m) => (typeof m.content === 'string' ? m.content : JSON.stringify(m.content)))
    .join('\n')
    .replace(/\s+/g, ' ')
    .toLowerCase()
    .slice(0, 4096); // cap to keep embedding call fast
}

async function fetchEmbedding(text: string, cfg: SemanticConfig): Promise<number[] | null> {
  return new Promise((resolve) => {
    const body = JSON.stringify({ model: cfg.ollamaModel, prompt: text });
    let url: URL;
    try {
      validateUserSuppliedUrl(cfg.ollamaBaseUrl);
      url = new URL(`${cfg.ollamaBaseUrl.replace(/\/$/, '')}/api/embeddings`);
    } catch {
      resolve(null);
      return;
    }

    const options = {
      hostname: url.hostname,
      port: url.port || 11434,
      path: url.pathname,
      method: 'POST',
      headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) },
    };

    const req = http.request(options, (res) => {
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try {
          const json = JSON.parse(Buffer.concat(chunks).toString('utf8'));
          resolve(Array.isArray(json.embedding) ? (json.embedding as number[]) : null);
        } catch {
          resolve(null);
        }
      });
    });
    req.on('error', () => resolve(null));
    req.setTimeout(5000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

function cosineSimilarity(a: number[], b: number[]): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0, normA = 0, normB = 0;
  for (let i = 0; i < a.length; i++) {
    dot += a[i] * b[i];
    normA += a[i] * a[i];
    normB += b[i] * b[i];
  }
  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

async function semanticLookup(messages: Message[], database: Database, cfg: SemanticConfig): Promise<string | null> {
  const text = messagesText(messages);
  const queryEmbedding = await fetchEmbedding(text, cfg);
  if (!queryEmbedding) return null;

  const rows = database.exec('SELECT embedding, response FROM embeddings ORDER BY ts DESC LIMIT 200');
  const entries = rows[0]?.values ?? [];

  let bestScore = -1;
  let bestResponse: string | null = null;

  for (const row of entries) {
    try {
      const stored: number[] = JSON.parse(row[0] as string);
      const score = cosineSimilarity(queryEmbedding, stored);
      if (score > bestScore) {
        bestScore = score;
        bestResponse = row[1] as string;
      }
    } catch { /* skip malformed */ }
  }

  if (bestScore >= cfg.similarityThreshold && bestResponse) {
    return bestResponse;
  }
  return null;
}

async function storeEmbedding(
  messages: Message[],
  response: string,
  database: Database,
  cfg: SemanticConfig,
  maxBytes: number,
  scope: Record<string, unknown>
): Promise<void> {
  const text = messagesText(messages);
  const embedding = await fetchEmbedding(text, cfg);
  if (!embedding) return;

  const hash = hashPrompt(messages, scope);
  const embJson = JSON.stringify(embedding);
  const size = Buffer.byteLength(response) + Buffer.byteLength(embJson);

  database.run(
    'INSERT OR REPLACE INTO embeddings (hash, embedding, response, ts, size) VALUES (?,?,?,?,?)',
    [hash, embJson, response, Date.now(), size]
  );

  // Enforce the same size cap on embeddings table
  const totalResult = database.exec('SELECT SUM(size) FROM embeddings');
  const totalSize = Number(totalResult[0]?.values[0]?.[0] ?? 0);
  if (totalSize > maxBytes) {
    database.run(
      'DELETE FROM embeddings WHERE hash IN (SELECT hash FROM embeddings ORDER BY ts ASC LIMIT 20)'
    );
  }

  persistDb();
}
