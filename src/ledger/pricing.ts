/**
 * Live model pricing from OpenRouter API.
 * Fetched once per day and cached in .tpt/pricing.json.
 * Falls back to the last successful cache (up to 3 months old) when offline.
 * Returns 0 cost when no pricing data is available — never uses hardcoded values.
 */

import * as fs from 'fs';
import * as path from 'path';
import * as https from 'https';
import * as vscode from 'vscode';

const CACHE_TTL_MS      = 24 * 60 * 60 * 1000;        // refresh every 24 hours
const CACHE_MAX_AGE_MS  = 90 * 24 * 60 * 60 * 1000;   // discard cache older than 3 months

interface PriceEntry {
  promptPer1M: number;
  completionPer1M: number;
  fetchedAt: number;
}

let priceCache: Map<string, PriceEntry> = new Map();
let lastFetchAttempt = 0;
let fetchedAt = 0;

// Fuzzy lookup in the live/cached price map only — no hardcoded fallbacks.
function lookupPrice(model: string): { promptPer1M: number; completionPer1M: number } | undefined {
  const m = model.toLowerCase().trim();
  if (!m) return undefined; // a missing model name must not match the first table entry

  // Exact cache hit
  const exact = priceCache.get(m);
  if (exact) return exact;

  // OpenRouter ids are "vendor/model"; clients send the bare name, sometimes with a date
  // suffix ("claude-sonnet-4-20250514"). Match the bare name, and prefer the longest match
  // so "gpt-4o-mini" never gets the price of "gpt-4o".
  let best: PriceEntry | undefined;
  let bestLen = -1;
  for (const [key, entry] of priceCache) {
    const tail = key.split('/').pop() ?? key;
    // Only a dated snapshot suffix ("-20250514") counts as the same model
    const matches = m === tail || (m.startsWith(tail + '-') && /^\d{8}$/.test(m.slice(tail.length + 1)));
    if (matches && tail.length > bestLen) {
      best = entry;
      bestLen = tail.length;
    }
  }

  return best; // no data — caller should treat cost as unknown (0)
}

export function getCostUsd(model: string, tokensIn: number, tokensOut: number): number {
  const price = lookupPrice(model);
  if (!price) return 0;
  return (tokensIn * price.promptPer1M + tokensOut * price.completionPer1M) / 1_000_000;
}

// ── cache persistence ─────────────────────────────────────────────────────────

function getCacheDir(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return undefined;
  const dir = path.join(folders[0].uri.fsPath, '.tpt');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

interface PricingJson {
  fetchedAt: number;
  prices: Record<string, { promptPer1M: number; completionPer1M: number }>;
}

function loadCachedPrices(): void {
  const dir = getCacheDir();
  if (!dir) return;
  const cachePath = path.join(dir, 'pricing.json');
  if (!fs.existsSync(cachePath)) return;
  try {
    const data = JSON.parse(fs.readFileSync(cachePath, 'utf8')) as PricingJson;
    if (!data.fetchedAt || !data.prices) return;
    // Discard cache if it's older than 3 months — prices will have drifted too far
    if (Date.now() - data.fetchedAt > CACHE_MAX_AGE_MS) return;
    fetchedAt = data.fetchedAt;
    priceCache = new Map(
      Object.entries(data.prices).map(([k, v]) => [k, { ...v, fetchedAt: data.fetchedAt }])
    );
  } catch { /* corrupt cache — ignore */ }
}

function saveCachedPrices(): void {
  const dir = getCacheDir();
  if (!dir) return;
  const prices: Record<string, { promptPer1M: number; completionPer1M: number }> = {};
  for (const [k, v] of priceCache) {
    prices[k] = { promptPer1M: v.promptPer1M, completionPer1M: v.completionPer1M };
  }
  const data: PricingJson = { fetchedAt: Date.now(), prices };
  try {
    fs.writeFileSync(path.join(dir, 'pricing.json'), JSON.stringify(data, null, 2));
  } catch { /* ignore write errors */ }
}

function fetchOpenRouterPrices(apiKey: string): Promise<void> {
  return new Promise((resolve) => {
    const options: https.RequestOptions = {
      hostname: 'openrouter.ai',
      path: '/api/v1/models',
      method: 'GET',
      headers: {
        'authorization': `Bearer ${apiKey}`,
        'user-agent': 'tpt-code-command-center/0.1.0',
      },
    };

    const req = https.request(options, (res) => {
      if (res.statusCode !== 200) { resolve(); return; }
      const chunks: Buffer[] = [];
      res.on('data', (c: Buffer) => chunks.push(c));
      res.on('end', () => {
        try {
          const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
            data?: { id: string; pricing?: { prompt: string; completion: string } }[]
          };
          for (const model of body.data ?? []) {
            if (!model.pricing) continue;
            const promptPer1M     = parseFloat(model.pricing.prompt)     * 1_000_000;
            const completionPer1M = parseFloat(model.pricing.completion) * 1_000_000;
            // OpenRouter reports -1 for variable-priced routers: that is "unknown", not a credit
            if (!isNaN(promptPer1M) && !isNaN(completionPer1M) && promptPer1M >= 0 && completionPer1M >= 0) {
              priceCache.set(model.id.toLowerCase(), { promptPer1M, completionPer1M, fetchedAt: Date.now() });
            }
          }
          fetchedAt = Date.now();
          saveCachedPrices();
        } catch { /* ignore parse errors */ }
        resolve();
      });
    });
    req.on('error', () => resolve());
    req.setTimeout(8000, () => { req.destroy(); resolve(); });
    req.end();
  });
}

/** Called once on activation, then automatically refreshes every 24 h. */
export async function initPricing(openrouterApiKey: string): Promise<void> {
  loadCachedPrices();

  const now = Date.now();
  if (fetchedAt && now - fetchedAt < CACHE_TTL_MS) return; // cache is fresh
  if (now - lastFetchAttempt < 60_000) return;             // don't hammer on failures

  lastFetchAttempt = now;
  if (openrouterApiKey) {
    await fetchOpenRouterPrices(openrouterApiKey);
  }
}
