# Contributing to TPT Code Command Center

Thank you for your interest. This project is dual-licensed under MIT or Apache 2.0, at your option. Contributions are **issues only** — bug reports, feature requests, and ideas are welcome via GitHub Issues, but pull requests are not accepted.

---

## Development Setup

### Prerequisites

- Node.js 18+
- VS Code 1.85+
- Git

### Clone and build

```bash
git clone https://github.com/PhillipC05/tpt-code-command-center
cd tpt-code-command-center
npm install
npm run compile
```

### Run in development

Press `F5` in VS Code. This opens a new **Extension Development Host** window with the extension loaded. The proxy will start and print its URL to the Output Channel.

### Watch mode

```bash
npm run watch
```

TypeScript recompiles on every save. You can reload the Extension Development Host with `Ctrl+R`.

---

## Project Structure

```
src/
  extension.ts          Entry point — activate/deactivate
  proxy/
    server.ts           HTTP server, port binding, forwarding logic
    pipeline.ts         Ordered middleware chain
    types.ts            Shared Anthropic/OpenAI request types
  modules/              One file per TPT module
  ledger/ledger.ts      sql.js token/cost database
  ui/                   Status bar and WebView dashboard
  utils/                Config helpers, hash, logger
```

The pipeline in `proxy/pipeline.ts` is the core flow. Each module exports a pure function (or async function) that takes the request body and returns a modified copy — no side effects except the ledger and cache writes.

---

## Adding a Module

1. Create `src/modules/yourModule.ts` and export a `run*` function
2. Add the module's toggle setting to `package.json` under `contributes.configuration`
3. Add the toggle to `src/utils/config.ts` `TptConfig` interface and `getConfig()`
4. Wire it into `src/proxy/pipeline.ts` at the appropriate pipeline position
5. Add the toggle to `src/ui/statusBar.ts` Quick Pick menu
6. Document it in `README.md` and add tasks to `TODO.md`

---

## Code Style

- TypeScript strict mode (`"strict": true` in `tsconfig.json`)
- No comments unless the *why* is non-obvious
- No native Node.js modules — the extension must install cleanly on all platforms without compilation
- Prefer `async/await` over raw Promises
- All user-visible strings go through VS Code UI APIs (`showInformationMessage`, Output Channel, WebView)

---

## Contributing to the Forge Registry

The Forge registry lives in this repository, in the `forge-registry/` folder (`index.json` and `configs/`).

Community configs are plain JSON files. Supported types:

### Router rule set (`type: "router-rule"`)
```json
[
  {
    "match": { "maxTokens": 1000, "keywords": ["fix typo"] },
    "model": "gpt-4o-mini",
    "provider": "openai"
  }
]
```

### Vault pattern set (`type: "vault-pattern"`)
```json
["MY_COMPANY_KEY_[A-Z0-9]{32}", "INTERNAL_SECRET_[0-9a-f]{40}"]
```

### System prompt (`type: "system-prompt"`)
```json
{ "text": "Your custom system prompt here." }
```

To suggest a config: open a GitHub Issue on `tpt-solutions/tpt-code-command-center` with your JSON inlined. See [forge-registry/CONTRIBUTING.md](forge-registry/CONTRIBUTING.md) for the format and checks.

---

## Reporting Bugs and Requesting Features

Open a GitHub Issue. For bugs, include:

- VS Code version
- Extension version
- Which AI tool you are using (Cline, Claude Code, other)
- The Output Channel log (toggle `tpt.terminal.verboseLogging: true` first)
- Steps to reproduce
