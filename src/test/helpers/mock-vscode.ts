// Registers a minimal vscode stub so pure-function tests can import modules
// that transitively require vscode without needing the VS Code runtime.
// Import this file FIRST before any module with a vscode dependency.

// Settings the tests can override, keyed as the code reads them: "upstreamProvider",
// "router.enabled", "router.rules" and so on. Anything not set falls back to the default
// the code passes to get(). Module-level, so every module sees the same values.
export const testConfig: Record<string, unknown> = {};

// eslint-disable-next-line @typescript-eslint/no-var-requires
const Module = require('module') as { _load: (...a: unknown[]) => unknown };
const original = Module._load;
// eslint-disable-next-line @typescript-eslint/no-explicit-any
Module._load = function (...args: any[]) {
  const request: string = args[0];
  const rest = args.slice(1);
  if (request === 'vscode') {
    return {
      workspace: {
        getConfiguration: () => ({
          get: (key: string, defaultValue: unknown) =>
            key in testConfig ? testConfig[key] : defaultValue,
          update: () => Promise.resolve(),
        }),
        workspaceFolders: undefined,
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
    };
  }
  return original.call(this, ...[request, ...rest]);
};
