import * as fs from 'fs';
import * as path from 'path';
import * as vscode from 'vscode';
import { Message } from '../proxy/types';

// Cross-session recall: on the first turn of a new conversation, bring in the Memory Weaver
// summaries from earlier sessions that share words with the request. The summaries are a
// suggestion for the model, not a fact, so they are labelled as possibly irrelevant.

export interface StoredSummary {
  ts: number;
  summary: string;
}

const STOP_WORDS = new Set([
  'about', 'because', 'could', 'from', 'have', 'help', 'into', 'just', 'like', 'make', 'need',
  'should', 'some', 'than', 'that', 'them', 'then', 'there', 'their', 'they', 'this', 'want',
  'what', 'when', 'where', 'which', 'with', 'would', 'your',
]);

// The distinct words of a text that could carry meaning: at least four letters, not a stop word
export function meaningfulWords(text: string): Set<string> {
  return new Set(
    text.toLowerCase().split(/[^a-z0-9_]+/).filter((w) => w.length >= 4 && !STOP_WORDS.has(w))
  );
}

// The summaries that share the most words with the query, best first. A summary must share at
// least `minScore` of the query's words, so one common word cannot bring in unrelated history.
export function selectRecall(
  summaries: StoredSummary[],
  query: string,
  max = 2,
  minScore = 0.2
): StoredSummary[] {
  const queryWords = meaningfulWords(query);
  if (queryWords.size === 0) return [];
  return summaries
    .map((s) => {
      const summaryWords = meaningfulWords(s.summary);
      let shared = 0;
      for (const w of queryWords) if (summaryWords.has(w)) shared++;
      return { summary: s, score: shared / queryWords.size };
    })
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score || b.summary.ts - a.summary.ts)
    .slice(0, max)
    .map((x) => x.summary);
}

// The summaries Memory Weaver saved for this workspace. A missing or corrupt file gives none.
export function readMemorySummaries(): StoredSummary[] {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(folders[0].uri.fsPath, '.tpt', 'memory.json'), 'utf8'));
    if (!Array.isArray(parsed?.summaries)) return [];
    return parsed.summaries.filter(
      (s: unknown): s is StoredSummary =>
        !!s && typeof (s as StoredSummary).summary === 'string' && typeof (s as StoredSummary).ts === 'number'
    );
  } catch {
    return [];
  }
}

export function recallNote(recalled: StoredSummary[]): string {
  return [
    '[TPT recalled context from earlier sessions in this workspace. It may not apply to this request.]',
    ...recalled.map((r) => `- ${r.summary}`),
  ].join('\n');
}

// The text of the most recent user message. Tool results are not what the user typed, so they are skipped.
export function lastUserText(messages: Message[]): string {
  for (let i = messages.length - 1; i >= 0; i--) {
    const m = messages[i];
    if (m.role !== 'user') continue;
    if (typeof m.content === 'string') return m.content;
    if (!Array.isArray(m.content)) continue;
    const text = (m.content as unknown as { type?: string; text?: string }[])
      .filter((b) => b.type === 'text' && typeof b.text === 'string')
      .map((b) => b.text)
      .join('\n');
    if (text) return text;
  }
  return '';
}

// A conversation is new when the user has written one message so far
export function isFirstTurn(messages: Message[]): boolean {
  return messages.filter((m) => m.role === 'user').length <= 1;
}

// Puts text at the front of the system prompt, in the shape the request's format uses
export function prependSystemText(body: Record<string, unknown>, format: 'anthropic' | 'openai', text: string): Record<string, unknown> {
  if (format === 'anthropic') {
    const system = body.system;
    if (typeof system === 'string') return { ...body, system: `${text}\n\n${system}` };
    if (Array.isArray(system)) return { ...body, system: [{ type: 'text', text }, ...system] };
    return { ...body, system: text };
  }
  const messages = [...((body.messages as Message[] | undefined) ?? [])];
  const index = messages.findIndex((m) => m.role === 'system');
  if (index >= 0) {
    const existing = messages[index].content;
    messages[index] = {
      ...messages[index],
      content: `${text}\n\n${typeof existing === 'string' ? existing : JSON.stringify(existing)}`,
    };
  } else {
    messages.unshift({ role: 'system', content: text });
  }
  return { ...body, messages };
}
