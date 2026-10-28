import * as crypto from 'crypto';
import * as path from 'path';
import * as fs from 'fs';
import * as https from 'https';
import * as vscode from 'vscode';
import { log } from '../utils/logger';
import { RouterRule, getConfig, validateUserSuppliedUrl } from '../utils/config';

const DEFAULT_REGISTRY_URL = 'https://raw.githubusercontent.com/tpt-solutions/tpt-code-command-center/master/forge-registry/index.json';

export interface ForgeEntry {
  name: string;
  description: string;
  type: 'router-rule' | 'vault-pattern' | 'system-prompt';
  url: string;
  version: string;
  localContent?: unknown;
  // Optional SHA-256 of the file at `url`, as 64 hex characters. A mismatch refuses the install.
  sha256?: string;
}

export const BUILTIN_FORGE_ENTRIES: ForgeEntry[] = [
  {
    name: 'default-router-rules',
    description: 'Comprehensive TPT Router ruleset — routes short/simple prompts to cheaper models and code, debugging, and security contexts to capable models',
    type: 'router-rule',
    url: 'https://raw.githubusercontent.com/tpt-solutions/tpt-code-command-center/master/forge-registry/configs/default-router-rules.json',
    version: '1.0.0',
    localContent: [
      { match: { maxTokens: 1500 }, model: 'openai/gpt-4o-mini', provider: 'openrouter' },
      { match: { keywords: ['summarize', 'summarise', 'tldr', 'brief', 'overview', 'explain'] }, model: 'openai/gpt-4o-mini', provider: 'openrouter' },
      { match: { keywords: ['translate', 'grammar', 'spelling', 'proofread', 'rephrase'] }, model: 'openai/gpt-4o-mini', provider: 'openrouter' },
      { match: { extensions: ['ts', 'tsx', 'js', 'jsx', 'py', 'go', 'rs', 'java', 'cpp', 'cs', 'c', 'h', 'hpp'] }, model: 'openai/gpt-4o', provider: 'openrouter' },
      { match: { extensions: ['sql', 'prisma', 'graphql'] }, model: 'openai/gpt-4o', provider: 'openrouter' },
      { match: { keywords: ['debug', 'error', 'exception', 'stack trace', 'crash', 'traceback', 'bug', 'fix'] }, model: 'openai/gpt-4o', provider: 'openrouter' },
      { match: { keywords: ['refactor', 'optimise', 'optimize', 'performance', 'architecture', 'design pattern'] }, model: 'openai/gpt-4o', provider: 'openrouter' },
      { match: { keywords: ['security', 'vulnerability', 'cve', 'authentication', 'authorisation', 'authorization', 'encrypt', 'xss', 'injection'] }, model: 'openai/gpt-4o', provider: 'openrouter' },
      { match: { keywords: ['migrate', 'migration', 'schema change', 'breaking change'] }, model: 'openai/gpt-4o', provider: 'openrouter' },
    ],
  },
  {
    name: 'common-vault-patterns',
    description: 'Extended credential patterns for Slack, SendGrid, Twilio, Google Cloud, Azure AD, and generic internal API key formats',
    type: 'vault-pattern',
    url: 'https://raw.githubusercontent.com/tpt-solutions/tpt-code-command-center/master/forge-registry/configs/common-vault-patterns.json',
    version: '1.0.0',
    localContent: [
      '(?i)(?:azure|az)[_\\-]?(?:tenant|client|subscription)[_\\-]?(?:id|secret|key)\\s*[=:]\\s*[\'"]?[a-zA-Z0-9\\-]{8,}',
      '(?i)(?:internal|int|svc|service)[_\\-]?(?:api[_\\-]?key|token|secret)\\s*[=:]\\s*[\'"]?[a-zA-Z0-9_\\-]{16,}',
      '(?i)(?:db|database|postgres|mysql|mongo|redis)[_\\-]?(?:url|uri|conn(?:ection)?[_\\-]?str(?:ing)?)\\s*[=:]\\s*[\'"]?\\S{12,}',
      '(?i)(?:smtp|mail)[_\\-]?(?:password|pass|pwd|secret)\\s*[=:]\\s*[\'"]?\\S{8,}',
    ],
  },
  {
    name: 'silent-edit-system-prompt',
    description: 'System prompt template that instructs LLMs to output file edits using the TPT Silent Edit tpt-edit JSON schema',
    type: 'system-prompt',
    url: 'https://raw.githubusercontent.com/tpt-solutions/tpt-code-command-center/master/forge-registry/configs/silent-edit-system-prompt.json',
    version: '1.0.0',
    localContent: {
      name: 'TPT Silent Edit Schema',
      description: 'Instructs LLMs to apply file edits using the tpt-edit JSON block format so changes are applied directly by the extension without showing markdown diffs in the chat.',
      text: 'You can apply file edits without showing markdown diffs by outputting a JSON block in this exact format:\n```tpt-edit\n{"file":"<relative-path>","startLine":<1-indexed>,"endLine":<1-indexed>,"newContent":"<replacement lines>"}\n```\nUse this format when making code changes. Multiple edits can be output as separate blocks.\nNormal text responses are fine when no edits are needed.',
    },
  },
];

// The install folder, without creating it. Undefined when no workspace folder is open.
function forgeDir(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return undefined;
  return path.join(folders[0].uri.fsPath, '.tpt', 'forge');
}

function getTptDir(): string | undefined {
  const dir = forgeDir();
  if (dir && !fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  return dir;
}

// Each installed file is an envelope: the type tells the pipeline how to use the content.
export interface InstalledEnvelope {
  name: string;
  type: ForgeEntry['type'];
  version: string;
  content: unknown;
}

const ENTRY_TYPES: readonly ForgeEntry['type'][] = ['router-rule', 'vault-pattern', 'system-prompt'];

export function parseEnvelope(raw: unknown): InstalledEnvelope | undefined {
  const v = raw as Partial<InstalledEnvelope> | null;
  if (!v || typeof v !== 'object') return undefined;
  if (typeof v.name !== 'string' || !ENTRY_TYPES.includes(v.type as ForgeEntry['type'])) return undefined;
  if (!('content' in v)) return undefined;
  return v as InstalledEnvelope;
}

export interface InstalledForge {
  routerRules: RouterRule[];
  vaultPatterns: string[];
  systemPrompt?: string;
}

// Turns installed envelopes into the settings the pipeline uses. Shapes that do not match the
// type are ignored; the modules that consume them still validate each rule and pattern.
export function collectInstalledForge(envelopes: InstalledEnvelope[]): InstalledForge {
  const out: InstalledForge = { routerRules: [], vaultPatterns: [] };
  for (const env of envelopes) {
    if (env.type === 'router-rule' && Array.isArray(env.content)) {
      out.routerRules.push(...env.content.filter((r): r is RouterRule => !!r && typeof r === 'object' && !Array.isArray(r)));
    } else if (env.type === 'vault-pattern' && Array.isArray(env.content)) {
      out.vaultPatterns.push(...env.content.filter((p): p is string => typeof p === 'string'));
    } else if (env.type === 'system-prompt') {
      const text = (env.content as { text?: unknown } | null)?.text;
      if (typeof text === 'string') out.systemPrompt = text;
    }
  }
  return out;
}

// Installed files are read on every request, so each one is parsed only when its size or
// modification time changes.
const installedCache = new Map<string, { mtimeMs: number; size: number; envelope?: InstalledEnvelope }>();

function readInstalledEnvelopes(): InstalledEnvelope[] {
  const dir = forgeDir();
  if (!dir || !fs.existsSync(dir)) return [];
  const out: InstalledEnvelope[] = [];
  for (const file of fs.readdirSync(dir)) {
    if (!file.endsWith('.json')) continue;
    const full = path.join(dir, file);
    let stat: fs.Stats;
    try {
      stat = fs.statSync(full);
    } catch {
      continue;
    }
    let cached = installedCache.get(full);
    if (!cached || cached.mtimeMs !== stat.mtimeMs || cached.size !== stat.size) {
      let envelope: InstalledEnvelope | undefined;
      try {
        envelope = parseEnvelope(JSON.parse(fs.readFileSync(full, 'utf8')));
      } catch {
        envelope = undefined;
      }
      cached = { mtimeMs: stat.mtimeMs, size: stat.size, envelope };
      installedCache.set(full, cached);
    }
    if (cached.envelope) out.push(cached.envelope);
  }
  return out;
}

export function loadInstalledForge(): InstalledForge {
  return collectInstalledForge(readInstalledEnvelopes());
}

const FORGE_FETCH_TIMEOUT_MS = 10_000;
const FORGE_MAX_BYTES = 5 * 1024 * 1024;

// Registry content is untrusted input: https only, bounded time and size, and a non-200
// answer is an error rather than something to parse.
function fetchBytes(url: string): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    if (!url.startsWith('https://')) {
      reject(new Error(`Forge registry must use https (got ${url})`));
      return;
    }
    const req = https.get(url, { headers: { 'user-agent': 'tpt-code-command-center/0.1.0' } }, (res) => {
      if (res.statusCode !== 200) {
        res.resume();
        reject(new Error(`Forge registry answered HTTP ${res.statusCode}`));
        return;
      }
      const chunks: Buffer[] = [];
      let total = 0;
      res.on('data', (c: Buffer) => {
        total += c.length;
        if (total > FORGE_MAX_BYTES) {
          req.destroy(new Error('Forge registry response too large'));
          return;
        }
        chunks.push(c);
      });
      res.on('end', () => resolve(Buffer.concat(chunks)));
    });
    req.setTimeout(FORGE_FETCH_TIMEOUT_MS, () => req.destroy(new Error('Forge registry timed out')));
    req.on('error', reject);
  });
}

function fetchJson(url: string): Promise<unknown> {
  return fetchBytes(url).then((raw) => JSON.parse(raw.toString('utf8')));
}

// A registry entry may pin the SHA-256 of its file. The bytes checked are the bytes installed.
export function verifyForgePin(raw: Buffer, expected: string | undefined, name: string): boolean {
  if (!expected) return false;
  const actual = crypto.createHash('sha256').update(raw).digest('hex');
  if (actual !== expected.toLowerCase()) {
    throw new Error(`hash mismatch for ${name}: pinned ${expected}, downloaded ${actual}`);
  }
  return true;
}

export async function fetchForgeIndex(): Promise<ForgeEntry[]> {
  const config = getConfig();
  const registryUrl = config.forge.registryUrl || DEFAULT_REGISTRY_URL;

  let remoteEntries: ForgeEntry[] = [];
  try {
    validateUserSuppliedUrl(registryUrl);
    const data = await fetchJson(registryUrl) as { entries?: unknown };
    remoteEntries = Array.isArray(data.entries) ? data.entries.filter(isForgeEntry) : [];
  } catch (e) {
    log(`Forge: registry unreachable (${registryUrl}) — using built-in entries. ${e}`);
  }

  return mergeForgeEntries(BUILTIN_FORGE_ENTRIES, remoteEntries);
}

// An unpinned remote entry has no integrity check, so it cannot replace a built-in of the same name.
// Pinned remote entries replace built-ins, which is how an updated config reaches users.
export function mergeForgeEntries(builtins: ForgeEntry[], remote: ForgeEntry[]): ForgeEntry[] {
  const merged = new Map<string, ForgeEntry>();
  for (const entry of builtins) merged.set(entry.name, entry);
  for (const entry of remote) {
    if (merged.has(entry.name) && !entry.sha256) continue;
    merged.set(entry.name, entry);
  }
  return [...merged.values()];
}

// A remote file with no pin: TPT cannot check the bytes it downloads. Built-in entries are not remote.
export function isUnpinned(entry: ForgeEntry): boolean {
  return entry.localContent === undefined && !entry.sha256;
}

// Registry data is untrusted: an entry must name a known type and a string name and version.
function isForgeEntry(value: unknown): value is ForgeEntry {
  const v = value as Partial<ForgeEntry> | null;
  return !!v &&
    typeof v.name === 'string' &&
    typeof v.version === 'string' &&
    typeof v.url === 'string' &&
    typeof v.description === 'string' &&
    ENTRY_TYPES.includes(v.type as ForgeEntry['type']);
}

export async function installForgeEntry(entry: ForgeEntry): Promise<boolean> {
  const dir = getTptDir();
  if (!dir) {
    vscode.window.showErrorMessage('TPT Forge requires an open workspace folder.');
    return false;
  }

  try {
    let content: unknown;
    if (entry.localContent !== undefined) {
      content = entry.localContent;
    } else {
      validateUserSuppliedUrl(entry.url);
      const raw = await fetchBytes(entry.url);
      if (!verifyForgePin(raw, entry.sha256, entry.name)) {
        log(`Forge: ${entry.name} has no sha256 pin; installed without integrity check`);
      }
      content = JSON.parse(raw.toString('utf8'));
    }
    const envelope: InstalledEnvelope = { name: entry.name, type: entry.type, version: entry.version, content };
    const filename = `${entry.name.replace(/[^a-z0-9_-]/gi, '-')}.json`;
    fs.writeFileSync(path.join(dir, filename), JSON.stringify(envelope, null, 2));
    log(`Forge: installed ${entry.name}`);
    return true;
  } catch (e) {
    log(`Forge: failed to install ${entry.name} — ${e}`);
    return false;
  }
}

// Re-installs every installed entry that the registry still lists, so pinned remote content
// picks up new versions. An unreachable registry leaves the installed files as they are.
export async function refreshInstalledForge(): Promise<number> {
  const installed = new Set(readInstalledEnvelopes().map((e) => e.name));
  if (installed.size === 0) return 0;

  let refreshed = 0;
  for (const entry of await fetchForgeIndex()) {
    if (!installed.has(entry.name)) continue;
    // Background refresh never installs a file it cannot check; the user installs those by hand
    if (isUnpinned(entry)) {
      log(`Forge: ${entry.name} is not pinned, so it was not refreshed in the background`);
      continue;
    }
    if (await installForgeEntry(entry)) refreshed++;
  }
  return refreshed;
}

export async function browseForge(): Promise<void> {
  const entries = await fetchForgeIndex();

  const picked = await vscode.window.showQuickPick(
    entries.map((e) => ({
      label: e.name,
      description: e.type,
      detail: `${e.description}${e.localContent !== undefined ? ' (built-in)' : ''}`,
      entry: e,
    })),
    { placeHolder: 'Select a community config to install', matchOnDescription: true, matchOnDetail: true }
  );

  if (!picked) return;

  if (isUnpinned(picked.entry)) {
    const choice = await vscode.window.showWarningMessage(
      `"${picked.entry.name}" has no sha256 pin, so TPT cannot check the file it downloads. Only install it if you trust its source.`,
      { modal: true },
      'Install anyway'
    );
    if (choice !== 'Install anyway') return;
  }

  const ok = await installForgeEntry(picked.entry);
  if (ok) {
    vscode.window.showInformationMessage(`TPT Forge: installed "${picked.entry.name}" to .tpt/forge/`);
  } else {
    vscode.window.showErrorMessage(`TPT Forge: failed to install "${picked.entry.name}"`);
  }
}
