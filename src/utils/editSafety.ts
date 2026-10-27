import * as path from 'path';

// Resolves an LLM-supplied relative file path against the workspace root.
// Returns undefined when the path is absolute, empty, or escapes the root,
// so a model (or a prompt injection) cannot write outside the workspace.
export function resolveWorkspaceFile(rootPath: string, file: unknown): string | undefined {
  if (typeof file !== 'string' || file.trim() === '') return undefined;
  if (path.isAbsolute(file) || path.win32.isAbsolute(file)) return undefined;

  const root = path.resolve(rootPath);
  const target = path.resolve(root, file);
  const rel = path.relative(root, target);
  // Escapes only when the first segment is ".." itself (not a name such as "..config")
  const escapes = rel === '..' || rel.startsWith('..' + path.sep);
  if (rel === '' || escapes || path.isAbsolute(rel)) return undefined;
  return target;
}

// Validates a 1-based inclusive line range against a document's line count.
// Line numbers come from the model and routinely drift, so reject anything
// that is not a positive integer range inside the file. An end past the last line
// is rejected too: clamping it would quietly replace everything down to the end of the file.
export function isValidEditRange(startLine: unknown, endLine: unknown, lineCount: number): boolean {
  if (!Number.isInteger(startLine) || !Number.isInteger(endLine)) return false;
  const s = startLine as number;
  const e = endLine as number;
  return s >= 1 && e >= s && s <= lineCount && e <= lineCount;
}
