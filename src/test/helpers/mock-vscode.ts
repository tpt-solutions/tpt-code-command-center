// Registers a minimal vscode stub so pure-function tests can import modules
// that transitively require vscode without needing the VS Code runtime.
// Import this file FIRST before any module with a vscode dependency.

// Settings the tests can override, keyed as the code reads them: "upstreamProvider",
// "router.enabled", "router.rules" and so on. Anything not set falls back to the default
// the code passes to get(). Module-level, so every module sees the same values.
export const testConfig: Record<string, unknown> = {};

// The workspace the tests can set up: folders, documents and applyEdit. Empty by default, so
// code that checks for an open folder behaves as it does with no folder open.
export const testWorkspace: {
  workspaceFolders?: { uri: { fsPath: string } }[];
  openTextDocument?: (uri: { fsPath: string }) => Promise<unknown>;
  applyEdit?: (edit: FakeWorkspaceEdit) => Promise<boolean>;
} = {};

export interface FakeWorkspaceEdit {
  replaces: { uri: string; range: FakeRange; text: string }[];
}

export class FakeUri {
  constructor(public fsPath: string) {}
  static file(p: string): FakeUri { return new FakeUri(p); }
  toString(): string { return this.fsPath; }
}

export class FakeRange {
  constructor(
    public startLine: number,
    public startChar: number,
    public endLine: number,
    public endChar: number
  ) {}
}

export class FakeWorkspaceEditImpl implements FakeWorkspaceEdit {
  replaces: FakeWorkspaceEdit['replaces'] = [];
  replace(uri: FakeUri, range: FakeRange, text: string): void {
    this.replaces.push({ uri: uri.fsPath, range, text });
  }
}

const vscodeStub = {
  workspace: {
    getConfiguration: () => ({
      get: (key: string, defaultValue: unknown) =>
        key in testConfig ? testConfig[key] : defaultValue,
      update: () => Promise.resolve(),
    }),
    get workspaceFolders() { return testWorkspace.workspaceFolders; },
    openTextDocument: (uri: { fsPath: string }) =>
      testWorkspace.openTextDocument
        ? testWorkspace.openTextDocument(uri)
        : Promise.reject(new Error('no document in the test workspace')),
    applyEdit: (edit: FakeWorkspaceEdit) =>
      testWorkspace.applyEdit ? testWorkspace.applyEdit(edit) : Promise.resolve(true),
  },
  window: {
    createOutputChannel: () => ({
      appendLine: () => undefined,
      show: () => undefined,
    }),
  },
  commands: {
    executeCommand: () => Promise.resolve(),
  },
  ConfigurationTarget: { Workspace: 2, Global: 1 },
  Uri: FakeUri,
  Range: FakeRange,
  WorkspaceEdit: FakeWorkspaceEditImpl,
};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module') as { _load: (...a: unknown[]) => unknown };
const original = Module._load;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
Module._load = function (...args: any[]) {
  const request: string = args[0];
  const rest = args.slice(1);
  if (request === 'vscode') {
    return vscodeStub;
  }
  return original.call(this, ...[request, ...rest]);
};
