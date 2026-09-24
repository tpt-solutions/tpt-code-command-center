import * as vscode from 'vscode';

export type UpstreamProvider =
  | 'openrouter'
  | 'anthropic'
  | 'openai'
  | 'deepseek'
  | 'qwen'
  | 'kimi'
  | 'grok'
  | 'glm'
  | 'mimo'
  | 'mistral'
  | 'local'
  | 'custom';

export interface TptConfig {
  enabled: boolean;
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

export function getConfig(): TptConfig {
  const c = vscode.workspace.getConfiguration('tpt');
  return {
    enabled: c.get<boolean>('enabled', true),
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
  };
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
  const h = url.hostname.toLowerCase();
  // Block numeric private/reserved IP ranges; allow 'localhost' by name for local services
  const blockedNumericIp =
    /^127\./.test(h) ||
    /^10\./.test(h) ||
    /^192\.168\./.test(h) ||
    /^169\.254\./.test(h) ||
    /^172\.(1[6-9]|2\d|3[01])\./.test(h) ||
    h === '0.0.0.0' ||
    h === '::1';
  if (blockedNumericIp) {
    throw new Error(`Private/reserved IP ranges are not allowed as upstream URLs: ${h}`);
  }
}

export function resolveUpstreamUrl(config: TptConfig): { baseUrl: string; apiKey: string } {
  switch (config.upstreamProvider) {
    case 'anthropic':
      return { baseUrl: 'https://api.anthropic.com', apiKey: config.anthropicApiKey };
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
    case 'local': {
      validateUserSuppliedUrl(config.localBaseUrl || 'http://localhost:11434/v1');
      return { baseUrl: config.localBaseUrl, apiKey: '' };
    }
    case 'custom': {
      validateUserSuppliedUrl(config.customBaseUrl || 'http://localhost');
      return { baseUrl: config.customBaseUrl, apiKey: config.customApiKey };
    }
    case 'openrouter':
    default:
      return { baseUrl: 'https://openrouter.ai/api/v1', apiKey: config.openrouterApiKey };
  }
}
