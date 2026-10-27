import * as path from 'path';
import * as fs from 'fs';
import * as http from 'http';
import * as vscode from 'vscode';
import * as crypto from 'crypto';
import { Message } from '../proxy/types';
import { getConfig, resolveUpstreamUrl, validateUserSuppliedUrl } from '../utils/config';
import { log } from '../utils/logger';
import { buildUpstreamPath } from '../proxy/requestPaths';

// Ollama endpoint from the same setting Token Shield's embeddings use. Validated like any other
// user-supplied URL; an invalid value disables the Ollama backend instead of sending data elsewhere.
function ollamaTarget(): URL | undefined {
  const raw = getConfig().tokenShield.semanticCache.ollamaBaseUrl || 'http://localhost:11434';
  try {
    validateUserSuppliedUrl(raw);
    return new URL(raw);
  } catch {
    return undefined;
  }
}

// Counts text, tool inputs and tool results: all of them are sent upstream as context
function messageChars(msg: Message): number {
  if (typeof msg.content === 'string') return msg.content.length;
  if (!Array.isArray(msg.content)) return 0;
  let chars = 0;
  for (const block of msg.content) {
    const b = block as unknown as Record<string, unknown>;
    if (typeof b.text === 'string') chars += b.text.length;
    else if (b.type === 'tool_use') chars += JSON.stringify(b.input ?? {}).length;
    else if (b.type === 'tool_result') {
      chars += typeof b.content === 'string' ? b.content.length : JSON.stringify(b.content ?? '').length;
    }
  }
  return chars;
}

function estimateTokens(messages: Message[]): number {
  return Math.ceil(messages.reduce((n, m) => n + messageChars(m), 0) / 4);
}

// A message that carries tool results must stay with the assistant turn that issued them
function isToolResultMessage(msg: Message): boolean {
  if (msg.role === 'tool') return true;
  return Array.isArray(msg.content) &&
    msg.content.some((b) => (b as unknown as Record<string, unknown>).type === 'tool_result');
}

// Returns the last `count` messages, moved back as needed so the window never starts
// with an orphaned tool result (Anthropic and OpenAI reject those with a 400).
export function pairSafeTail(conversation: Message[], count: number): Message[] {
  let start = Math.max(0, conversation.length - count);
  while (start > 0 && isToolResultMessage(conversation[start])) start--;
  return conversation.slice(start);
}

// Summaries cut the conversation on multiples of this many messages. The summarised prefix then
// stays the same for SUMMARY_BLOCK turns, so the upstream prompt cache keeps hitting. A cut that
// moves every turn would miss the cache every turn and re-summarise every request.
export const SUMMARY_BLOCK = 8;
const KEEP_TAIL = 4;

// Index where the kept tail starts: the last multiple of SUMMARY_BLOCK that leaves at least
// KEEP_TAIL messages after it. Returns 0 when there is nothing to summarise yet.
export function summaryBoundary(conversation: Message[]): number {
  let boundary = Math.floor(Math.max(0, conversation.length - KEEP_TAIL) / SUMMARY_BLOCK) * SUMMARY_BLOCK;
  // The tail must not start on an orphaned tool result
  while (boundary > 0 && isToolResultMessage(conversation[boundary])) boundary--;
  return boundary;
}

// Summaries of prefixes already summarised, keyed by a hash of the prefix. Bounded, oldest first out.
const SUMMARY_MEMO_MAX = 16;
const summaryMemo = new Map<string, string>();

function prefixKey(prefix: Message[]): string {
  return crypto.createHash('sha256').update(JSON.stringify(prefix)).digest('hex');
}

function extractiveSummarise(messages: Message[], threshold: number): Message[] {
  // Keep system messages and last N messages that fit within threshold
  const system = messages.filter((m) => m.role === 'system');
  const conversation = messages.filter((m) => m.role !== 'system');
  const maxChars = threshold * 4 * 0.6; // keep 60% of threshold

  // Prefer the block-aligned cut when its tail fits the same 60% budget: it changes less from turn to turn
  const aligned = summaryBoundary(conversation);
  const alignedChars = conversation.slice(aligned).reduce((n, m) => n + messageChars(m), 0);
  let start = aligned;

  if (alignedChars > maxChars) {
    let chars = 0;
    start = conversation.length;
    for (let i = conversation.length - 1; i >= 0; i--) {
      const len = messageChars(conversation[i]);
      if (chars + len > maxChars) break;
      chars += len;
      start = i;
    }
  }

  // Extend the window backwards if it would begin with an orphaned tool result
  while (start > 0 && start < conversation.length && isToolResultMessage(conversation[start])) start--;

  let kept = conversation.slice(start);
  if (kept.length < conversation.length) {
    const summary: Message = {
      role: 'user',
      content: `[TPT Memory Weaver: ${conversation.length - kept.length} earlier messages were summarised to reduce context size. The most recent ${kept.length} messages follow.]`,
    };
    kept = [summary, ...kept];
  }

  return [...system, ...kept];
}

async function summariseViaOllama(messages: Message[], ollamaModel: string): Promise<string | null> {
  return new Promise((resolve) => {
    const conversation = messages.map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`).join('\n\n');
    const prompt = `Summarise the following conversation history concisely, preserving key decisions, code, and context:\n\n${conversation}`;
    const body = JSON.stringify({ model: ollamaModel, prompt, stream: false });

    const target = ollamaTarget();
    if (!target) {
      resolve(null);
      return;
    }
    const req = http.request(
      { hostname: target.hostname, port: target.port || 11434, path: buildUpstreamPath(target.pathname, '/api/generate'), method: 'POST',
        headers: { 'content-type': 'application/json', 'content-length': Buffer.byteLength(body) } },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString());
            resolve(parsed.response ?? null);
          } catch {
            resolve(null);
          }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(10000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

async function summariseViaProxy(messages: Message[], options: MemoryWeaverOptions): Promise<string | null> {
  const config = getConfig();
  const upstream = resolveUpstreamUrl(config);
  if (!upstream.apiKey && config.upstreamProvider !== 'local') return null;

  const https = require('https') as typeof import('https');
  const http = require('http') as typeof import('http');

  const conversation = messages
    .filter((m) => m.role !== 'system')
    .map((m) => `${m.role}: ${typeof m.content === 'string' ? m.content : JSON.stringify(m.content)}`)
    .join('\n\n');

  const summaryRequest = {
    model: config.upstreamProvider === 'anthropic' ? options.anthropicSummaryModel : options.openaiSummaryModel,
    max_tokens: 500,
    messages: [
      {
        role: 'user',
        content: `Summarise this conversation history in 3-5 bullet points, focusing on key decisions, code changes, and important context:\n\n${conversation.substring(0, 8000)}`,
      },
    ],
  };

  return new Promise((resolve) => {
    const url = new URL(upstream.baseUrl);
    const apiPath = config.upstreamProvider === 'anthropic' ? '/v1/messages' : '/v1/chat/completions';
    const body = JSON.stringify(summaryRequest);

    const headers: Record<string, string> = {
      'content-type': 'application/json',
      'content-length': Buffer.byteLength(body).toString(),
    };
    if (upstream.apiKey) {
      if (config.upstreamProvider === 'anthropic') {
        headers['x-api-key'] = upstream.apiKey;
        headers['anthropic-version'] = '2023-06-01';
      } else {
        headers['authorization'] = `Bearer ${upstream.apiKey}`;
      }
    }

    const proto = url.protocol === 'https:' ? https : http;
    const req = proto.request(
      { hostname: url.hostname, port: url.port || (url.protocol === 'https:' ? 443 : 80),
        path: buildUpstreamPath(url.pathname, apiPath), method: 'POST', headers },
      (res) => {
        const chunks: Buffer[] = [];
        res.on('data', (c: Buffer) => chunks.push(c));
        res.on('end', () => {
          try {
            const parsed = JSON.parse(Buffer.concat(chunks).toString());
            const text = parsed.content?.[0]?.text ?? parsed.choices?.[0]?.message?.content ?? null;
            resolve(text);
          } catch { resolve(null); }
        });
      }
    );
    req.on('error', () => resolve(null));
    req.setTimeout(15000, () => { req.destroy(); resolve(null); });
    req.write(body);
    req.end();
  });
}

function saveMemory(summary: string): void {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return;
  const dir = path.join(folders[0].uri.fsPath, '.tpt');
  if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
  const memPath = path.join(dir, 'memory.json');
  // A corrupt file must not break the request: start a fresh history instead
  let existing: { summaries: { ts: number; summary: string }[] } = { summaries: [] };
  try {
    const parsed = JSON.parse(fs.readFileSync(memPath, 'utf8'));
    if (Array.isArray(parsed?.summaries)) existing = parsed;
  } catch { /* missing or corrupt: keep the empty history */ }
  existing.summaries.push({ ts: Date.now(), summary });
  if (existing.summaries.length > 10) existing.summaries = existing.summaries.slice(-10);
  // Write to a temp file then rename, so a crash mid-write cannot corrupt the history
  const tmpPath = `${memPath}.tmp`;
  fs.writeFileSync(tmpPath, JSON.stringify(existing, null, 2));
  fs.renameSync(tmpPath, memPath);
}

export interface MemoryWeaverOptions {
  tokenThreshold: number;
  fallbackOrder: string[];
  anthropicSummaryModel: string;
  openaiSummaryModel: string;
  ollamaModel: string;
}

export interface MemoryWeaverResult {
  messages: Message[];
  summarised: boolean;
}

// Returns the summary of a prefix. A prefix summarised before is reused, so repeat requests do not
// call the summariser again. Only a new summary is saved to memory.json.
async function summariseOrReuse(
  prefix: Message[],
  summarise: () => Promise<string | null>
): Promise<{ text: string; fresh: boolean } | null> {
  const key = prefixKey(prefix);
  const known = summaryMemo.get(key);
  if (known !== undefined) return { text: known, fresh: false };

  const text = await summarise();
  if (!text) return null;
  summaryMemo.set(key, text);
  if (summaryMemo.size > SUMMARY_MEMO_MAX) {
    summaryMemo.delete(summaryMemo.keys().next().value as string);
  }
  saveMemory(text);
  return { text, fresh: true };
}

export async function runMemoryWeaver(
  messages: Message[],
  options: MemoryWeaverOptions
): Promise<MemoryWeaverResult> {
  const tokenCount = estimateTokens(messages);
  if (tokenCount <= options.tokenThreshold) {
    return { messages, summarised: false };
  }

  log(`Memory Weaver triggered — estimated ${tokenCount} tokens (threshold: ${options.tokenThreshold})`);

  const system = messages.filter((m) => m.role === 'system');
  const conversation = messages.filter((m) => m.role !== 'system');
  const boundary = summaryBoundary(conversation);
  const prefix = conversation.slice(0, boundary);
  const tail = conversation.slice(boundary);

  for (const backend of options.fallbackOrder) {
    if (backend === 'ollama' || backend === 'proxy') {
      // With nothing before the tail there is nothing to summarise yet
      if (boundary === 0) continue;
      const label = backend === 'ollama' ? 'Ollama' : 'proxy LLM';
      const summary = await summariseOrReuse(prefix, () =>
        backend === 'ollama'
          ? summariseViaOllama(prefix, options.ollamaModel)
          : summariseViaProxy(prefix, options)
      );
      if (summary) {
        const summaryMsg: Message = { role: 'user', content: `[Memory Weaver Summary]\n${summary.text}` };
        log(`Memory Weaver: ${summary.fresh ? 'summarised' : 'reused a summary'} via ${label}`);
        return { messages: [...system, summaryMsg, ...tail], summarised: true };
      }
    } else if (backend === 'extractive') {
      const trimmed = extractiveSummarise(messages, options.tokenThreshold);
      log('Memory Weaver: applied extractive summarisation');
      return { messages: trimmed, summarised: true };
    }
  }

  return { messages, summarised: false };
}
