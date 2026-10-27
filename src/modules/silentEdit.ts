import * as vscode from 'vscode';
import { AnthropicRequest, OpenAIRequest } from '../proxy/types';
import { log } from '../utils/logger';
import { isValidEditRange, resolveWorkspaceFile } from '../utils/editSafety';

const SILENT_EDIT_SCHEMA = `
You can apply file edits without showing markdown diffs by outputting a JSON block in this exact format:
\`\`\`tpt-edit
{"file":"<relative-path>","startLine":<1-indexed>,"endLine":<1-indexed>,"newContent":"<replacement lines>"}
\`\`\`
Use this format when making code changes. Multiple edits can be output as separate blocks.
Normal text responses are fine when no edits are needed.
`;

// The block ends at a fence that sits alone at the end of its line. A triple backtick inside
// the JSON (for example in Markdown content) is followed by more text on the same line, so it
// does not close the block early.
const TPT_EDIT_SOURCE = '```tpt-edit\\s*([\\s\\S]*?)\\n?\\s*```(?=[ \\t]*(?:\\r?\\n|$))';

export interface SilentEditInstruction {
  file: string;
  startLine: number;
  endLine: number;
  newContent: string;
}

function isValidInstruction(value: unknown): value is SilentEditInstruction {
  const v = value as Partial<SilentEditInstruction> | null;
  return !!v &&
    typeof v.file === 'string' &&
    typeof v.newContent === 'string' &&
    Number.isInteger(v.startLine) &&
    Number.isInteger(v.endLine);
}

// Pulls every well-formed tpt-edit block out of a model reply. Malformed blocks are skipped.
export function extractEditInstructions(text: string): SilentEditInstruction[] {
  if (!text.includes('```tpt-edit')) return [];
  const re = new RegExp(TPT_EDIT_SOURCE, 'g');
  const out: SilentEditInstruction[] = [];
  let match: RegExpExecArray | null;
  while ((match = re.exec(text)) !== null) {
    try {
      const parsed: unknown = JSON.parse(match[1].trim());
      if (isValidInstruction(parsed)) out.push(parsed);
    } catch { /* not JSON — skip this block */ }
  }
  return out;
}

export function runSilentEditInjection(
  body: AnthropicRequest | OpenAIRequest | Record<string, unknown>,
  format: 'anthropic' | 'openai'
): AnthropicRequest | OpenAIRequest | Record<string, unknown> {
  const b = body as AnthropicRequest;

  if (format === 'anthropic') {
    if (typeof b.system === 'string') {
      return { ...b, system: SILENT_EDIT_SCHEMA + '\n\n' + b.system };
    }
    if (Array.isArray(b.system)) {
      return {
        ...b,
        system: [{ type: 'text', text: SILENT_EDIT_SCHEMA }, ...b.system],
      };
    }
    return { ...b, system: SILENT_EDIT_SCHEMA };
  }

  // OpenAI format: prepend to system message or add one
  const messages = [...((b as OpenAIRequest).messages ?? [])];
  const sysIdx = messages.findIndex((m) => m.role === 'system');
  if (sysIdx >= 0) {
    messages[sysIdx] = {
      ...messages[sysIdx],
      content: SILENT_EDIT_SCHEMA + '\n\n' + (typeof messages[sysIdx].content === 'string' ? messages[sysIdx].content : JSON.stringify(messages[sysIdx].content)),
    };
  } else {
    messages.unshift({ role: 'system', content: SILENT_EDIT_SCHEMA });
  }
  return { ...b, messages };
}

// Anthropic replies can start with thinking or tool_use blocks, so every text block counts
function anthropicText(parsed: { content?: Array<{ type?: string; text?: string }> }): string {
  return (parsed.content ?? [])
    .filter((b) => b.type === 'text' && typeof b.text === 'string')
    .map((b) => b.text as string)
    .join('\n');
}

export async function handleSilentEditResponse(responseBody: string): Promise<string> {
  let responseText: string;
  try {
    const parsed = JSON.parse(responseBody);
    responseText = anthropicText(parsed);
    // OpenAI format
    if (!responseText) responseText = parsed.choices?.[0]?.message?.content ?? '';
  } catch {
    return responseBody;
  }

  const instructions = extractEditInstructions(responseText);
  if (instructions.length > 0) proposeEdits(instructions);
  return responseBody;
}

export async function handleSilentEditStreamResponse(accumulated: string, format: 'anthropic' | 'openai'): Promise<void> {
  let fullText = '';
  for (const line of accumulated.split('\n')) {
    const trimmed = line.trim();
    if (!trimmed.startsWith('data: ')) continue;
    const data = trimmed.slice(6).trim();
    if (data === '[DONE]') continue;
    try {
      const parsed = JSON.parse(data);
      if (format === 'anthropic') {
        if (parsed.type === 'content_block_delta' && parsed.delta?.type === 'text_delta') {
          fullText += parsed.delta.text ?? '';
        }
      } else {
        fullText += parsed.choices?.[0]?.delta?.content ?? '';
      }
    } catch { /* skip malformed event */ }
  }

  const instructions = extractEditInstructions(fullText);
  if (instructions.length > 0) proposeEdits(instructions);
}

// Edits are proposed, not applied: the user confirms first, so text injected through a file or
// tool output cannot rewrite the workspace silently. Fire-and-forget, so the client response is
// not held while the user decides.
export function proposeEdits(instructions: SilentEditInstruction[]): void {
  const files = [...new Set(instructions.map((i) => i.file))].join(', ');
  vscode.window.showInformationMessage(
    `TPT: the model proposed ${instructions.length} edit(s) to ${files}.`,
    'Apply', 'Discard'
  ).then((choice) => {
    if (choice === 'Apply') {
      return applyEdits(instructions);
    }
    log('Silent Edit: proposal discarded');
    return undefined;
  }, (err) => log(`Silent Edit: confirmation failed: ${err}`));
}

async function applyEdits(instructions: SilentEditInstruction[]): Promise<void> {
  const workspaceEdit = new vscode.WorkspaceEdit();
  const folders = vscode.workspace.workspaceFolders;
  if (!folders?.length) return;

  const root = folders[0].uri;

  for (const instr of instructions) {
    // Model output is untrusted: keep every edit inside the workspace root
    const targetPath = resolveWorkspaceFile(root.fsPath, instr.file);
    if (!targetPath) {
      log(`Silent Edit: rejected path outside workspace: ${instr.file}`);
      continue;
    }
    const fileUri = vscode.Uri.file(targetPath);

    let document: vscode.TextDocument;
    try {
      document = await vscode.workspace.openTextDocument(fileUri);
    } catch {
      log(`Silent Edit: could not open file ${instr.file}`);
      continue;
    }

    if (!isValidEditRange(instr.startLine, instr.endLine, document.lineCount)) {
      log(`Silent Edit: invalid range L${instr.startLine}-${instr.endLine} for ${instr.file} (${document.lineCount} lines)`);
      continue;
    }

    const startLine = instr.startLine - 1;
    const endLine = Math.min(document.lineCount - 1, instr.endLine - 1);
    const endChar = document.lineAt(endLine).range.end.character;
    const range = new vscode.Range(startLine, 0, endLine, endChar);

    workspaceEdit.replace(fileUri, range, instr.newContent);
    log(`Silent Edit: ${instr.file} L${instr.startLine}-${instr.endLine}`);
  }

  const applied = await vscode.workspace.applyEdit(workspaceEdit);
  if (!applied) {
    log('Silent Edit: VS Code rejected the batch (overlapping or stale ranges); no changes applied');
  }
}
