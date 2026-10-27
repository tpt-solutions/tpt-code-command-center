import * as path from 'path';
import * as fs from 'fs';
import * as vscode from 'vscode';

// Used when no workspace folder is open: the extension's global storage folder
let fallbackDir: string | undefined;
export function setFallbackDataDir(dir: string): void { fallbackDir = dir; }

// Returns undefined (and callers keep their data in memory) when the folder cannot be created,
// for example a read-only or virtual workspace; requests must still be served.
function ensureDir(dir: string): string | undefined {
  try {
    if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
    return dir;
  } catch {
    return undefined;
  }
}

// The `.tpt` folder of the first workspace folder, or the global storage folder without one.
// The ledger and the pricing cache both live here, so a window with no folder still keeps them.
export function dataDir(): string | undefined {
  const folders = vscode.workspace.workspaceFolders;
  if (folders?.length) {
    return ensureDir(path.join(folders[0].uri.fsPath, '.tpt'));
  }
  if (fallbackDir) {
    return ensureDir(fallbackDir);
  }
  return undefined;
}
