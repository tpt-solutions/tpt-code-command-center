import * as vscode from 'vscode';
import { API_KEY_SETTINGS, cachedKey } from './secrets';
import { applyWorkspacePolicy } from '../modules/policy';

export const UPSTREAM_PROVIDERS = [
  'openrouter',
  'anthropic',
  'openai',
  'deepseek',
  'qwen',
  'kimi',
  'grok',
  'glm',
  'mimo',
  'mistral',
  'groq',
  'gemini',
  'local',
  'custom',
] as const;

export type UpstreamProvider = typeof UPSTREAM_PROVIDERS[number];

export function isUpstreamProvider(value: unknown): value is UpstreamProvider {
  return typeof value === 'string' && (UPSTREAM_PROVIDERS as readonly string[]).includes(value);
}

export interface TptConfig {
  enabled: boolean;
  // Measure what the modules would change, but send the request exactly as the client wrote it
  dryRun: boolean;
  upstreamProvider: UpstreamProvider;
  openrouterApiKey: string;
  anthropicApiKey: string;
  openaiApiKey: string;
  deepseekApiKey: string;
  qwenApiKey: string;
  kimiApiKey: string;
  grokApiKey: string;
  glmApiKey: string;
  mimoApiKey: string;
  mistralApiKey: string;
  groqApiKey: string;
  geminiApiKey: string;
  localBaseUrl: string;
  customBaseUrl: string;
  customApiKey: string;
  vault: { enabled: boolean; customRegex: string[] };
  smartContext: { enabled: boolean; maxFileSize: number };
  weave: { enabled: boolean; cliPath: string; level: number };
  tokenShield: {
    enabled: boolean;
    maxCacheSizeMB: number;
    semanticCache: {
      enabled: boolean;
      similarityThreshold: number;
      ollamaModel: string;
      ollamaBaseUrl: string;
    };
  };
  memoryWeaver: {
    enabled: boolean;
    tokenThreshold: number;
    fallbackOrder: string[];
    anthropicSummaryModel: string;
    openaiSummaryModel: string;
    ollamaModel: string;
    // Bring summaries from earlier sessions into the first turn of a new conversation
    recallEnabled: boolean;
  };
  router: { enabled: boolean; rules: RouterRule[] };
  silentEdit: { enabled: boolean };
  promptCache: { enabled: boolean };
  forge: { autoUpdate: boolean; registryUrl: string };
  terminal: { verboseLogging: boolean };
  costBudget: { dailyLimitUsd: number; monthlyLimitUsd: number; hardStop: boolean; quotaPollingIntervalSec: number };
}

export interface RouterRule {
  match: { maxTokens?: number; keywords?: string[]; extensions?: string[] };
  model: string;
  provider: string;
}

// Keys come from SecretStorage when it holds them; settings.json is only a fallback
function withSecretKeys(config: TptConfig): TptConfig {
  const overrides = config as unknown as Record<string, string>;
  for (const name of API_KEY_SETTINGS) {
    const secret = cachedKey(name);
    if (secret) overrides[name] = secret;
  }
  return config;
}

// The settings every request uses: the user's own, tightened by a workspace policy the user trusts
export function getConfig(): TptConfig {
  return applyWorkspacePolicy(readSettings());
}

function readSettings(): TptConfig {
  const c = vscode.workspace.getConfiguration('tpt');
  return withSecretKeys({
    enabled: c.get<boolean>('enabled', true),
    dryRun: c.get<boolean>('dryRun', false),
    upstreamProvider: c.get<UpstreamProvider>('upstreamProvider', 'openrouter'),
    openrouterApiKey: c.get<string>('openrouterApiKey', ''),
    anthropicApiKey: c.get<string>('anthropicApiKey', ''),
    openaiApiKey: c.get<string>('openaiApiKey', ''),
    deepseekApiKey: c.get<string>('deepseekApiKey', ''),
    qwenApiKey: c.get<string>('qwenApiKey', ''),
    kimiApiKey: c.get<string>('kimiApiKey', ''),
    grokApiKey: c.get<string>('grokApiKey', ''),
    glmApiKey: c.get<string>('glmApiKey', ''),
    mimoApiKey: c.get<string>('mimoApiKey', ''),
    mistralApiKey: c.get<string>('mistralApiKey', ''),
    groqApiKey: c.get<string>('groqApiKey', ''),
    geminiApiKey: c.get<string>('geminiApiKey', ''),
    localBaseUrl: c.get<string>('localBaseUrl', 'http://localhost:11434/v1'),
    customBaseUrl: c.get<string>('customBaseUrl', ''),
    customApiKey: c.get<string>('customApiKey', ''),
    vault: {
      enabled: c.get<boolean>('vault.enabled', true),
      customRegex: c.get<string[]>('vault.customRegex', []),
    },
    smartContext: {
      enabled: c.get<boolean>('smartContext.enabled', true),
      maxFileSize: c.get<number>('smartContext.maxFileSize', 512000),
    },
    weave: {
      enabled: c.get<boolean>('weave.enabled', false),
      cliPath: c.get<string>('weave.cliPath', 'tpt-weave'),
      level: c.get<number>('weave.level', 2),
    },
    tokenShield: {
      enabled: c.get<boolean>('tokenShield.enabled', true),
      maxCacheSizeMB: c.get<number>('tokenShield.maxCacheSizeMB', 256),
      semanticCache: {
        enabled: c.get<boolean>('tokenShield.semanticCache.enabled', false),
        similarityThreshold: c.get<number>('tokenShield.semanticCache.similarityThreshold', 0.92),
        ollamaModel: c.get<string>('tokenShield.semanticCache.ollamaModel', 'nomic-embed-text'),
        ollamaBaseUrl: c.get<string>('tokenShield.semanticCache.ollamaBaseUrl', 'http://localhost:11434'),
      },
    },
    memoryWeaver: {
      enabled: c.get<boolean>('memoryWeaver.enabled', true),
      tokenThreshold: c.get<number>('memoryWeaver.tokenThreshold', 50000),
      fallbackOrder: c.get<string[]>('memoryWeaver.fallbackOrder', ['ollama', 'proxy', 'extractive']),
      anthropicSummaryModel: c.get<string>('memoryWeaver.anthropicSummaryModel', 'claude-haiku-4-5-20251001'),
      openaiSummaryModel:    c.get<string>('memoryWeaver.openaiSummaryModel',    'gpt-4o-mini'),
      ollamaModel:           c.get<string>('memoryWeaver.ollamaModel',            'llama3'),
      recallEnabled:         c.get<boolean>('memoryWeaver.recall.enabled',        false),
    },
    router: {
      enabled: c.get<boolean>('router.enabled', false),
      rules: c.get<RouterRule[]>('router.rules', []),
    },
    silentEdit: {
      enabled: c.get<boolean>('silentEdit.enabled', false),
    },
    promptCache: {
      enabled: c.get<boolean>('promptCache.enabled', true),
    },
    forge: {
      autoUpdate: c.get<boolean>('forge.autoUpdate', true),
      registryUrl: c.get<string>('forge.registryUrl', ''),
    },
    terminal: {
      verboseLogging: c.get<boolean>('terminal.verboseLogging', false),
    },
    costBudget: {
      dailyLimitUsd: c.get<number>('costBudget.dailyLimitUsd', 0),
      monthlyLimitUsd: c.get<number>('costBudget.monthlyLimitUsd', 0),
      hardStop: c.get<boolean>('costBudget.hardStop', false),
      quotaPollingIntervalSec: c.get<number>('costBudget.quotaPollingIntervalSec', 180),
    },
  });
}

export function workspaceRoots(): string[] {
  return (vscode.workspace.workspaceFolders ?? []).map((f) => f.uri.fsPath);
}

// Blocks SSRF attacks via user-configurable URL fields.
// Allows localhost by name (needed for Ollama) but rejects numeric private/reserved IPs.
export function validateUserSuppliedUrl(raw: string): void {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`Invalid URL: ${raw}`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) {
    throw new Error(`Only http/https URLs are allowed (got ${url.protocol})`);
  }
  // URL.hostname keeps IPv6 brackets ("[::1]"), so strip them before matching
  const h = url.hostname.toLowerCase().replace(/^\[|\]$/g, '');
  if (isBlockedHost(h)) {
    throw new Error(`Private/reserved IP ranges are not allowed as upstream URLs: ${h}`);
  }
}

// 'localhost' is allowed by name (Ollama and similar); numeric private, loopback,
// link-local, CGNAT and metadata addresses are not, in any notation.
function isBlockedHost(h: string): boolean {
  // IPv4-mapped IPv6: "::ffff:127.0.0.1", or the hex form URL parsing produces ("::ffff:7f00:1")
  const mapped = /^::ffff:(?:(\d+\.\d+\.\d+\.\d+)|([0-9a-f]{1,4}):([0-9a-f]{1,4}))$/.exec(h);
  if (mapped) {
    if (mapped[1]) return isBlockedIpv4(mapped[1]);
    const hi = parseInt(mapped[2], 16);
    const lo = parseInt(mapped[3], 16);
    return isBlockedIpv4([hi >> 8, hi & 0xff, lo >> 8, lo & 0xff].join('.'));
  }

  if (h.includes(':')) {
    // Loopback, unspecified, unique-local (fc00::/7), link-local (fe80::/10)
    return h === '::1' || h === '::' || /^f[cd]/.test(h) || /^fe[89ab]/.test(h);
  }

  // Dotted-quad IPv4 only; decimal/hex/octal forms are normalised below
  const parsed = parseLooseIpv4(h);
  if (parsed) return isBlockedIpv4(parsed);
  return false;
}

// Accepts 127.0.0.1, 2130706433 (decimal), 0x7f000001 (hex) and similar single-number forms
function parseLooseIpv4(h: string): string | undefined {
  if (/^\d+\.\d+\.\d+\.\d+$/.test(h)) return h;
  if (/^(0x[0-9a-f]+|\d+)$/.test(h)) {
    const n = h.startsWith('0x') ? parseInt(h, 16) : Number(h);
    if (!Number.isFinite(n) || n < 0 || n > 0xffffffff) return undefined;
    return [24, 16, 8, 0].map((s) => (n >>> s) & 0xff).join('.');
  }
  return undefined;
}

function isBlockedIpv4(ip: string): boolean {
  const [a, b] = ip.split('.').map(Number);
  return (
    a === 0 ||                         // 0.0.0.0/8 "this network"
    a === 10 ||                        // 10.0.0.0/8
    a === 127 ||                       // loopback
    (a === 169 && b === 254) ||        // link-local + cloud metadata
    (a === 172 && b >= 16 && b <= 31) ||
    (a === 192 && b === 168) ||
    (a === 100 && b >= 64 && b <= 127) // CGNAT 100.64.0.0/10
  );
}

// Test-only seam: the end-to-end tests point the Anthropic provider at a local stand-in. It is not
// a setting, so no user configuration can send the Anthropic key anywhere else.
let anthropicBaseForTests: string | undefined;
export function setAnthropicBaseUrlForTests(url: string | undefined): void {
  anthropicBaseForTests = url;
}

export function resolveUpstreamUrl(config: TptConfig): { baseUrl: string; apiKey: string } {
  switch (config.upstreamProvider) {
    case 'anthropic':
      return { baseUrl: anthropicBaseForTests ?? 'https://api.anthropic.com', apiKey: config.anthropicApiKey };
    case 'openai':
      return { baseUrl: 'https://api.openai.com/v1', apiKey: config.openaiApiKey };
    case 'deepseek':
      return { baseUrl: 'https://api.deepseek.com/v1', apiKey: config.deepseekApiKey };
    case 'qwen':
      return { baseUrl: 'https://dashscope.aliyuncs.com/compatible-mode/v1', apiKey: config.qwenApiKey };
    case 'kimi':
      return { baseUrl: 'https://api.moonshot.cn/v1', apiKey: config.kimiApiKey };
    case 'grok':
      return { baseUrl: 'https://api.x.ai/v1', apiKey: config.grokApiKey };
    case 'glm':
      return { baseUrl: 'https://api.z.ai/api/paas/v4', apiKey: config.glmApiKey };
    case 'mimo':
      return { baseUrl: 'https://api.xiaomimimo.com/v1', apiKey: config.mimoApiKey };
    case 'mistral':
      return { baseUrl: 'https://api.mistral.ai/v1', apiKey: config.mistralApiKey };
    case 'groq':
      return { baseUrl: 'https://api.groq.com/openai/v1', apiKey: config.groqApiKey };
    case 'gemini':
      // Gemini's OpenAI-compatible endpoint has no /v1 suffix; see upstreamRequestPath
      return { baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', apiKey: config.geminiApiKey };
    case 'local': {
      const baseUrl = (config.localBaseUrl || 'http://localhost:11434/v1').trim();
      validateUserSuppliedUrl(baseUrl);
      return { baseUrl, apiKey: '' };
    }
    case 'custom': {
      const baseUrl = (config.customBaseUrl || 'http://localhost').trim();
      validateUserSuppliedUrl(baseUrl);
      return { baseUrl, apiKey: config.customApiKey };
    }
    case 'openrouter':
    default:
      return { baseUrl: 'https://openrouter.ai/api/v1', apiKey: config.openrouterApiKey };
  }
}
