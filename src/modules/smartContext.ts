import * as path from 'path';
import { ContentBlock, Message } from '../proxy/types';

// web-tree-sitter is loaded lazily — types kept as any to avoid version-skew issues
// eslint-disable-next-line @typescript-eslint/no-explicit-any
let Parser: any;
let parserInitialized = false;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
const parsersCache = new Map<string, any>();

// Directory containing bundled language .wasm files — set once on extension activation
let wasmDir = '';

export function setWasmDir(dir: string): void {
  wasmDir = dir;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function getParser(language: string): Promise<any | undefined> {
  if (parsersCache.has(language)) return parsersCache.get(language);

  try {
    if (!Parser) {
      Parser = require('web-tree-sitter');
    }
    if (!parserInitialized) {
      // Locate the runtime WASM from the bundled media/wasm directory when available
      const runtimeWasm = wasmDir ? path.join(wasmDir, 'tree-sitter.wasm') : undefined;
      await Parser.init(runtimeWasm ? { locateFile: () => runtimeWasm } : undefined);
      parserInitialized = true;
    }

    const wasmFile = languageToWasm(language);
    if (!wasmFile) return undefined;
    if (!wasmDir) return undefined; // WASM files not bundled — fall back to regex outline

    const wasmPath = path.join(wasmDir, wasmFile);
    const langModule = await Parser.Language.load(wasmPath);
    const parser = new Parser();
    parser.setLanguage(langModule);
    parsersCache.set(language, parser);
    return parser;
  } catch {
    return undefined;
  }
}

function languageToWasm(ext: string): string | undefined {
  const map: Record<string, string> = {
    ts: 'tree-sitter-typescript.wasm',
    tsx: 'tree-sitter-typescript.wasm',
    js: 'tree-sitter-javascript.wasm',
    jsx: 'tree-sitter-javascript.wasm',
    py: 'tree-sitter-python.wasm',
    go: 'tree-sitter-go.wasm',
    rs: 'tree-sitter-rust.wasm',
    cs: 'tree-sitter-c_sharp.wasm',
    java: 'tree-sitter-java.wasm',
    php: 'tree-sitter-php.wasm',
    rb: 'tree-sitter-ruby.wasm',
  };
  return map[ext];
}

function getFileExtension(text: string, toolCallPath?: string): string | undefined {
  // Prefer the explicit path argument from the tool call
  if (toolCallPath) {
    const parts = toolCallPath.split('.');
    if (parts.length > 1) return parts[parts.length - 1].toLowerCase();
  }
  // Fallback: scan content for a filename pattern
  const match = text.match(/(?:file|path|filename):\s*["']?([^\s"']+\.\w+)/i);
  if (match) {
    const parts = match[1].split('.');
    return parts[parts.length - 1].toLowerCase();
  }
  return undefined;
}

function extractOutlineFromText(content: string): string {
  const lines = content.split('\n');
  const outline: string[] = [];
  let lineNo = 0;

  for (const line of lines) {
    lineNo++;
    const trimmed = line.trim();
    if (
      /^(?:export\s+)?(?:async\s+)?(?:function|class|interface|type|enum|const\s+\w+\s*=\s*(?:async\s+)?\(|let\s+\w+\s*=\s*(?:async\s+)?\(|var\s+\w+\s*=\s*(?:async\s+)?\()/.test(trimmed) ||
      /^(?:def |class |async def )/.test(trimmed) ||
      /^(?:pub |pub\(crate\) )?(?:fn |struct |enum |trait |impl )/.test(trimmed) ||
      /^(?:public|private|protected|internal|static|override|virtual|abstract)\s+/.test(trimmed)
    ) {
      outline.push(`L${lineNo}: ${trimmed.substring(0, 120)}`);
    }
  }

  if (outline.length === 0) {
    return lines.slice(0, 50).join('\n') + (lines.length > 50 ? '\n[...truncated...]' : '');
  }

  return `[AST Outline — ${lines.length} lines total]\n${outline.join('\n')}`;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function extractOutlineWithParser(tree: any, originalSource: string): string {
  const lines = originalSource.split('\n');
  const outline: string[] = [`[AST Outline — ${lines.length} lines total]`];

  const interestingTypes = new Set([
    'function_declaration', 'function_definition', 'method_definition',
    'class_declaration', 'class_definition', 'interface_declaration',
    'type_alias_declaration', 'enum_declaration', 'struct_item', 'impl_item',
    'function_item', 'trait_item',
  ]);

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  function walk(node: any, depth: number): void {
    if (depth > 3) return;
    if (interestingTypes.has(node.type)) {
      const line = node.startPosition.row + 1;
      const text = lines[node.startPosition.row]?.trim().substring(0, 120) ?? '';
      outline.push(`L${line}: ${text}`);
    }
    for (let i = 0; i < node.childCount; i++) {
      const child = node.child(i);
      if (child) walk(child, depth + 1);
    }
  }

  walk(tree.rootNode, 0);
  return outline.join('\n');
}

export interface SmartContextResult {
  messages: Message[];
  replaced: number;
  /** Of `replaced`, how many came from the tpt-weave index (spec.md §32). */
  weaveReplaced: number;
}

/** Subset of the weave module's query surface used by Smart Context. */
export interface WeaveSkeletonSource {
  skeleton(relPath: string, rawBytes?: number): Promise<string | undefined>;
}

interface ToolCallInfo {
  name?: string;
  path?: string;
}

// Only results of file-reading tools are outlined. Bash output, search hits, test failures and
// build logs must reach the model intact: an outline would hide the very error being debugged.
const READ_TOOL_RE = /read|view|\bcat\b|open_file/i;

function pathFromInput(input: unknown): string | undefined {
  const i = input as Record<string, unknown> | undefined;
  if (typeof i?.path === 'string') return i.path;
  if (typeof i?.file_path === 'string') return i.file_path;
  return undefined;
}

// Maps tool_use ids to the tool name and file path. A tool_result carries only the id, so the
// path has to come from the assistant turn that issued the call (Anthropic tool_use blocks or
// OpenAI tool_calls).
function indexToolCalls(messages: Message[]): Map<string, ToolCallInfo> {
  const index = new Map<string, ToolCallInfo>();
  for (const msg of messages) {
    if (!Array.isArray(msg.content) && !Array.isArray((msg as { tool_calls?: unknown }).tool_calls)) continue;

    if (Array.isArray(msg.content)) {
      for (const block of msg.content as ContentBlock[]) {
        const b = block as unknown as Record<string, unknown>;
        if (b.type === 'tool_use' && typeof b.id === 'string') {
          index.set(b.id, { name: typeof b.name === 'string' ? b.name : undefined, path: pathFromInput(b.input) });
        }
      }
    }

    const toolCalls = (msg as unknown as { tool_calls?: unknown }).tool_calls;
    if (Array.isArray(toolCalls)) {
      for (const call of toolCalls as Array<Record<string, unknown>>) {
        const fn = call.function as Record<string, unknown> | undefined;
        if (typeof call.id !== 'string') continue;
        let input: unknown;
        try { input = JSON.parse(String(fn?.arguments ?? '{}')); } catch { input = undefined; }
        index.set(call.id, { name: typeof fn?.name === 'string' ? fn.name : undefined, path: pathFromInput(input) });
      }
    }
  }
  return index;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function freeTree(tree: any): void {
  if (typeof tree?.delete === 'function') tree.delete();
}

async function outlineFor(content: string, toolPath: string | undefined): Promise<string> {
  const ext = getFileExtension(content, toolPath);
  if (!ext) return extractOutlineFromText(content);

  const parser = await getParser(ext);
  if (!parser) return extractOutlineFromText(content);

  let tree;
  try {
    tree = parser.parse(content);
    return extractOutlineWithParser(tree, content);
  } catch {
    return extractOutlineFromText(content);
  } finally {
    freeTree(tree);
  }
}

export async function runSmartContext(
  messages: Message[],
  maxFileSize: number,
  weave?: WeaveSkeletonSource
): Promise<SmartContextResult> {
  let replaced = 0;
  let weaveReplaced = 0;
  const toolCalls = indexToolCalls(messages);

  // Replaces one tool result's text when it is a large read of a file. Returns undefined to keep it.
  async function replaceResult(toolUseId: unknown, content: string): Promise<string | undefined> {
    if (Buffer.byteLength(content) <= maxFileSize) return undefined;

    const call = typeof toolUseId === 'string' ? toolCalls.get(toolUseId) : undefined;
    if (!call || !call.name || !READ_TOOL_RE.test(call.name)) return undefined;

    const toolPath = call.path;

    // tpt-weave-indexed Rust files: skeleton from the shared index
    // (no duplicate parsing here; falls back on any miss/failure).
    if (weave && toolPath && toolPath.replace(/\\/g, '/').endsWith('.rs')) {
      const skeleton = await weave.skeleton(toolPath, Buffer.byteLength(content));
      if (skeleton) {
        weaveReplaced++;
        return skeleton;
      }
    }

    return outlineFor(content, toolPath);
  }

  const processedMessages = await Promise.all(
    messages.map(async (msg): Promise<Message> => {
      // OpenAI: each tool result is its own message with a string body
      if (msg.role === 'tool' && typeof msg.content === 'string') {
        const toolCallId = (msg as unknown as { tool_call_id?: unknown }).tool_call_id;
        const outline = await replaceResult(toolCallId, msg.content);
        if (outline === undefined) return msg;
        replaced++;
        return { ...msg, content: outline };
      }

      if (!Array.isArray(msg.content)) return msg;

      const processedContent = await Promise.all(
        (msg.content as ContentBlock[]).map(async (block): Promise<ContentBlock> => {
          if (block.type !== 'tool_result') return block;

          const blockRecord = block as unknown as Record<string, unknown>;
          const content = blockRecord.content;
          if (typeof content !== 'string') return block;

          const outline = await replaceResult(blockRecord.tool_use_id, content);
          if (outline === undefined) return block;
          replaced++;
          return { ...block, content: outline } as ContentBlock;
        })
      );

      return { ...msg, content: processedContent };
    })
  );

  return { messages: processedMessages, replaced, weaveReplaced };
}
