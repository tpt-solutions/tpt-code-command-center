# TPT Code Command Center

A VS Code extension that acts as a local HTTP proxy between your AI coding tools (Cline, Claude Code) and any LLM provider — intercepting every request to optimise token usage, redact secrets, cache identical prompts, and route traffic intelligently.

**Zero DevOps. No hosted backend. No Docker. Everything runs locally inside VS Code.**

---

## Features

| Module | What it does |
|--------|-------------|
| **TPT Vault** | Redacts AWS keys, Stripe tokens, GitHub PATs, JWTs, `.env` secrets, and custom patterns before any LLM sees them |
| **TPT Smart Context** | Replaces large file contents in tool calls with compact AST outlines — dramatically reduces tokens sent per request |
| **TPT Weave** | Routes Rust repository context through the [tpt-weave](https://github.com/tpt-solutions/tpt-weave) index (`tpt-weave adopt`) — exact signatures/skeletons from one shared index instead of re-parsing in the proxy |
| **TPT Token Shield** | Caches identical prompts locally (SHA-256 hash match) — zero cost on repeated queries |
| **TPT Memory Weaver** | Automatically summarises conversation history when it grows too large — keeps context costs in check |
| **TPT Router** | Rewrites the target model and provider based on configurable heuristics — send simple tasks to cheap local models |
| **TPT Silent Edit** | Intercepts AI JSON edit instructions and applies them as native undoable VS Code diffs |
| **TPT Prompt Cache** | Marks the system prompt and stable conversation history with Anthropic `cache_control` breakpoints to unlock its native prompt-caching discount |
| **TPT Forge** | Install community-maintained router rules, vault patterns, and system prompts from a GitHub registry |
| **TPT Terminal** | Live pipeline logs in the VS Code Output Channel |

For how TPT compares on cost with a Claude Pro subscription, see [claude-compare.md](claude-compare.md). Those figures are estimates, not measurements.

---

## Quick Start

### 1. Install the extension

From the `.vsix` file:

```
Extensions panel → ⋯ → Install from VSIX…
```

Or install from the VS Code Marketplace (coming soon).

### 2. Set your API key

Open VS Code Settings (`Ctrl+,`) and search for `tpt`:

```json
"tpt.upstreamProvider": "openrouter",
"tpt.openrouterApiKey": "sk-or-..."
```

**Supported providers:**

| Setting value | Routes to |
|---------------|-----------|
| `openrouter` (default) | [OpenRouter](https://openrouter.ai) — access all models with one key |
| `anthropic` | Anthropic API directly. OpenAI-format clients (Continue, Roo Code) are translated to the Anthropic format for it |
| `openai` | OpenAI API directly |
| `deepseek` | DeepSeek API directly |
| `qwen` | Alibaba Cloud DashScope (Qwen) |
| `kimi` | Moonshot AI (Kimi) |
| `grok` | xAI (Grok) |
| `glm` | Zhipu AI / Z.ai (GLM) |
| `mimo` | Xiaomi MiMo |
| `mistral` | Mistral AI directly |
| `local` | Ollama, LM Studio, or any local OpenAI-compatible server |
| `custom` | Any base URL you specify |

### 3. Connect your AI tools

When the extension activates, it starts a local proxy and prints the URL and session token in the **TPT Command Center** Output Channel.

**Claude Code** — the `ANTHROPIC_BASE_URL` environment variable is injected into all new VS Code terminals automatically. Open a new terminal and run Claude Code as normal.

**Cline** — open Cline settings and set:
- Provider: `OpenAI Compatible`
- Base URL: `http://localhost:7331` (or whatever port is shown in the Output Channel)
- Add header: `X-TPT-Token: <token shown in Output Channel>`

**Any other OpenAI-compatible tool** — point the base URL to `http://localhost:7331/v1`.

Step-by-step guides for each tool, and sample config files, are in [examples/](examples/): Claude Code, Cline, Roo Code, Continue and local models.

---

## Configuration Reference

All settings are under the `tpt.*` namespace in VS Code settings (`Ctrl+,` → search `tpt`).

### Core

| Setting | Default | Description |
|---------|---------|-------------|
| `tpt.enabled` | `true` | Master switch — bypass all modules when `false` |
| `tpt.dryRun` | `false` | Measure what the modules would change, but send every request exactly as the client wrote it. Use `TPT: Show Token Savings (Last Request)` to see the result. No cached answers are returned, and Memory Weaver uses only its local extractive backend |
| `tpt.upstreamProvider` | `openrouter` | Default upstream provider |
| `tpt.openrouterApiKey` | `""` | OpenRouter API key |
| `tpt.anthropicApiKey` | `""` | Anthropic API key |
| `tpt.openaiApiKey` | `""` | OpenAI API key |
| `tpt.localBaseUrl` | `http://localhost:11434/v1` | Local model server URL (Ollama default) |
| `tpt.customBaseUrl` | `""` | Custom upstream base URL |
| `tpt.customApiKey` | `""` | API key for custom upstream |
| `tpt.geminiApiKey`, `tpt.groqApiKey`, `tpt.mistralApiKey`, `tpt.glmApiKey`, `tpt.mimoApiKey`, `tpt.deepseekApiKey`, `tpt.qwenApiKey`, `tpt.kimiApiKey`, `tpt.grokApiKey` | `""` | Keys for the other hosted providers |

Keys are stored in VS Code's SecretStorage. A key still in `settings.json` is moved there on first run, and the key settings are deprecated. `TPT: Run Setup Wizard` sets them.

### TPT Vault

| Setting | Default | Description |
|---------|---------|-------------|
| `tpt.vault.enabled` | `true` | Enable secret redaction |
| `tpt.vault.customRegex` | `[]` | Additional regex patterns to redact |

### TPT Smart Context

| Setting | Default | Description |
|---------|---------|-------------|
| `tpt.smartContext.enabled` | `true` | Enable AST outline extraction |
| `tpt.smartContext.maxFileSize` | `512000` | Files larger than this (bytes) are outlined |

### TPT Weave

For repositories indexed with [`tpt-weave adopt`](https://github.com/tpt-solutions/tpt-weave) (Rust workspaces), tool results for `.rs` files are replaced by representations from the shared index instead of re-parsing here. Requires the `tpt-weave` CLI on PATH (or set `tpt.weave.cliPath`).

| Setting | Default | Description |
|---------|---------|-------------|
| `tpt.weave.enabled` | `false` | Route Rust repository context through tpt-weave when the workspace is indexed |
| `tpt.weave.cliPath` | `tpt-weave` | Path to the tpt-weave CLI binary |
| `tpt.weave.level` | `2` | Representation level: `2` signatures (compact), `3` skeleton (full signatures + types, more tokens) |

### TPT Token Shield

| Setting | Default | Description |
|---------|---------|-------------|
| `tpt.tokenShield.enabled` | `true` | Enable prompt caching |
| `tpt.tokenShield.maxCacheSizeMB` | `256` | Maximum local cache size |

### TPT Memory Weaver

| Setting | Default | Description |
|---------|---------|-------------|
| `tpt.memoryWeaver.enabled` | `true` | Enable context summarisation |
| `tpt.memoryWeaver.tokenThreshold` | `50000` | Token count that triggers summarisation |
| `tpt.memoryWeaver.fallbackOrder` | `["ollama","proxy","extractive"]` | Summarisation backend priority |
| `tpt.memoryWeaver.anthropicSummaryModel` | `claude-haiku-4-5-20251001` | Model used by the proxy backend for Anthropic requests |
| `tpt.memoryWeaver.openaiSummaryModel` | `gpt-4o-mini` | Model used by the proxy backend for OpenAI-format requests |
| `tpt.memoryWeaver.ollamaModel` | `llama3` | Model used by the Ollama backend |

### TPT Router

| Setting | Default | Description |
|---------|---------|-------------|
| `tpt.router.enabled` | `false` | Enable heuristic routing |
| `tpt.router.rules` | `[]` | Array of routing rules (see below). When empty, built-in defaults apply |

**Router rule format:**
```json
{
  "match": {
    "maxTokens": 2000,
    "keywords": ["fix typo", "rename"],
    "extensions": ["md", "txt"]
  },
  "model": "gpt-4o-mini",
  "provider": "openai"
}
```

Rules are evaluated in order. The first match wins.

### Cross-session recall (opt-in)

| Setting | Default | Description |
|---------|---------|-------------|
| `tpt.memoryWeaver.recall.enabled` | `false` | On the first turn of a new conversation, add the Memory Weaver summaries from earlier sessions that share words with the request, to the system prompt. Adds tokens and changes the prompt, so it is off by default |

### TPT Silent Edit

| Setting | Default | Description |
|---------|---------|-------------|
| `tpt.silentEdit.enabled` | `false` | Enable JSON-based silent edits |

### TPT Prompt Cache

| Setting | Default | Description |
|---------|---------|-------------|
| `tpt.promptCache.enabled` | `true` | Add Anthropic `cache_control` breakpoints to the system prompt and stable conversation history |

Anthropic and Mistral are the two providers in TPT's list that require an explicit opt-in to get their caching discount — the rest cache automatically upstream with no proxy involvement:

| Provider | Caching |
|----------|---------|
| Anthropic | Manual — requires `cache_control`. **TPT Prompt Cache adds this on every Anthropic-format request.** |
| Mistral | Manual — requires a stable `prompt_cache_key` on requests sharing a prefix (min 64 tokens per cache block). **TPT sets this automatically on every Mistral-bound request**, derived from the conversation's first message so it stays stable across turns. |
| OpenAI | Automatic for prompts ≥1024 tokens, no code needed |
| DeepSeek | Automatic disk-based caching, no code needed |
| Qwen (DashScope) | Automatic implicit caching on the OpenAI-compatible endpoint TPT uses; explicit `cache_control` is also supported if routed through Qwen's Anthropic-compatible endpoint |
| Kimi (Moonshot) | Automatic prefix caching on `kimi-k2.*` models, no code needed |
| Grok (xAI) | Automatic, and TPT sends a stable `x-grok-conv-id` header (derived from the conversation's first message) on every Grok-bound request so repeat turns route to the same server and hit cache more often |
| GLM (Zhipu/Z.ai) | Automatic — cached input billed at 1/5th normal price, no code needed |
| MiMo (Xiaomi) | Automatic prefix caching via the OpenAI-compatible endpoint, no code needed |

### TPT Token Shield — Semantic Cache (opt-in)

| Setting | Default | Description |
|---------|---------|-------------|
| `tpt.tokenShield.semanticCache.enabled` | `false` | Also match prompts by embedding similarity, using a local Ollama model |
| `tpt.tokenShield.semanticCache.similarityThreshold` | `0.92` | Cosine similarity needed for a semantic hit |
| `tpt.tokenShield.semanticCache.ollamaModel` | `nomic-embed-text` | Embedding model |
| `tpt.tokenShield.semanticCache.ollamaBaseUrl` | `http://localhost:11434` | Ollama server for embeddings |

### TPT Cost Budget

| Setting | Default | Description |
|---------|---------|-------------|
| `tpt.costBudget.dailyLimitUsd` | `0` | Warn when daily spend passes this amount (`0` disables) |
| `tpt.costBudget.monthlyLimitUsd` | `0` | Warn when monthly spend passes this amount (`0` disables) |
| `tpt.costBudget.hardStop` | `false` | Reject requests with HTTP 429 once a limit is reached, instead of only warning |
| `tpt.costBudget.quotaPollingIntervalSec` | `180` | How often quota is polled |

### TPT Forge

| Setting | Default | Description |
|---------|---------|-------------|
| `tpt.forge.autoUpdate` | `true` | On activation, re-install the Forge entries already installed in this workspace from the registry. This makes a network request to the registry when entries are installed |
| `tpt.forge.registryUrl` | `""` | Registry index URL. Empty uses the official registry. Must be `https` and cannot point at a private address |

A registry entry with a `sha256` pin is checked against the downloaded bytes. An entry without one has no integrity check: a background refresh skips it, and **TPT: Browse Forge** asks you to confirm before installing it. An unpinned remote entry cannot replace a built-in of the same name.

Installed entries take effect as follows:

| Type | Effect |
|------|--------|
| `router-rule` | Used as the router rules when `tpt.router.rules` is empty |
| `vault-pattern` | Added to the Vault's custom patterns |
| `system-prompt` | Replaces the Silent Edit schema text when Silent Edit is on |

Installing an entry is your consent to it. Router rules can send requests to another provider, and system prompts change what the model is told, so read an entry before installing it.

### TPT Terminal

| Setting | Default | Description |
|---------|---------|-------------|
| `tpt.terminal.verboseLogging` | `false` | Show per-request pipeline detail in Output Channel |

---

## Commands

Open the Command Palette (`Ctrl+Shift+P`) and type `TPT`:

| Command | Description |
|---------|-------------|
| `TPT: Toggle Entire Suite On/Off` | Also accessible by clicking the status bar icon |
| `TPT: Show Dashboard` | Open the token stats WebView panel |
| `TPT: Show Token Stats` | Quick stats notification |
| `TPT: Copy Proxy URL to Clipboard` | Copy `http://localhost:<port>` for manual tool setup |
| `TPT: Copy Session Token` | Copy the `X-TPT-Token` value |
| `TPT: Copy Claude Code Setup Snippet` | Copy environment variables for Claude Code (PowerShell or bash) |
| `TPT: Clear Local Cache` | Wipe the Token Shield prompt cache |
| `TPT: Show Memory Weaver Summaries` | Open `.tpt/memory.json`, the summaries Memory Weaver has written |
| `TPT: Clear Memory Weaver History` | Clear the summaries Memory Weaver keeps (asks first) |
| `TPT: Clear Request Ledger` | Delete the local request ledger |
| `TPT: Export Ledger to CSV` | Write every ledger row to a CSV file |
| `TPT: Export Monthly Summary to Downloads` | Write a per-month usage summary to your Downloads folder |
| `TPT: Apply Settings Preset` | Apply Frugal, Privacy-first, Local only (Ollama) or Anthropic tiering |
| `TPT: Configure Models` | Pick the models TPT uses |
| `TPT: Run Setup Wizard` | Choose a provider, enter a key and test the connection |
| `TPT: Reset Credentials & Provider` | Remove stored keys and the provider choice |
| `TPT: Test Connection` | Send a test request through the proxy |
| `TPT: Test Vault Patterns on Selection` | Show what the Vault would redact in the selected text |
| `TPT: Show Token Savings (Last Request)` | Per-stage size of the last request: what each module saved, or added |
| `TPT: Suggest Settings From History` | Read the measured requests and print suggestions for Memory Weaver and the router. Nothing is changed; needs 20 measured requests |
| `TPT: Export Savings Report (This Month)` | Write a Markdown report of what each module removed this month, to Downloads. Figures are estimates, not billed tokens |
| `TPT: Show Workspace Policy` | Show whether the repository's `tpt-policy.json` is present, valid, trusted, and what it would apply. A broken file is named here |
| `TPT: Inspect Last Request` | Dump the last request's processed body and module actions to the Output Channel |
| `TPT: Show Prompt Diff` | Compare the original and processed prompt side by side |
| `TPT: Auto-Configure Cline` | Set Cline's provider, base URL and headers to use TPT |
| `TPT: Open Settings` | Open the `tpt.*` settings |
| `TPT: Browse Forge` | Install community configs from the registry |

---

## Troubleshooting

**Requests fail with HTTP 401.** The client did not send the current session token. The token changes every time the extension activates. Run `TPT: Copy Session Token` and update the client, or run `TPT: Copy Claude Code Setup Snippet` again. The token can be sent as `X-TPT-Token`, as `Authorization: Bearer`, or as `x-api-key`.

**The port is not 7331.** Port 7331 was in use, so TPT took the next free port. The URL is in the TPT Command Center Output Channel. Copy the current URL with `TPT: Copy Proxy URL to Clipboard`.

**A terminal still points at an old URL or token.** TPT writes the environment into new terminals only. Close the terminal and open a new one.

**Costs or routing look wrong.** Turn on `tpt.terminal.verboseLogging` and run `TPT: Inspect Last Request`. The output lists each module's action and any router override.

---

## FAQ

**Does TPT send my code anywhere else?** Requests go from the local proxy to the provider you chose, and nowhere else. TPT also makes two other kinds of network call: it fetches model pricing from OpenRouter once a day, and it checks the Forge registry when Forge auto-update is on and entries are installed. Turn auto-update off with `tpt.forge.autoUpdate` if you do not want the registry call.

**Why are Router and Silent Edit off?** Routing changes which model answers, and Silent Edit changes how edits are applied. Both are worth turning on once you have looked at what they do in the Output Channel.

**Does routing to another provider need that provider's key?** Yes. A rule that sends a request to OpenAI, for example, needs `tpt.openaiApiKey`. Without it, the request is not sent to that provider.

**Are secrets redacted when the other modules are off?** Yes. Vault is its own setting and runs before the other modules. Redaction is pattern-based, so use `TPT: Test Vault Patterns on Selection` to check that a particular secret format is caught.

**Where is my data?** In `.tpt/` in the workspace, and nowhere else. See [Local Files](#local-files).

---

## Status Bar

The shield icon in the bottom-right of VS Code shows the current state:

- **Green** `🛡 TPT` — all modules active
- **Yellow** `🛡 TPT (4/6)` — some modules active
- **Red** `🛡 TPT` — suite bypassed

Click to open the toggle menu.

---

## Security

The proxy generates a random session token on every activation. All requests must include this token as the `X-TPT-Token` header. This prevents other local processes from routing traffic (and your API keys) through the proxy without your knowledge.

The token is printed to the **TPT Command Center** Output Channel on startup and is automatically injected into new VS Code terminal sessions.

---

## Local Files

TPT stores its data in a `.tpt/` folder at the workspace root:

```
.tpt/
  ledger.db      — token/cost history (sql.js SQLite)
  cache.db       — Token Shield prompt cache (sql.js SQLite)
  memory.json    — Memory Weaver conversation summaries
  forge/         — Installed Forge community configs
```

Add `.tpt/` to your `.gitignore` to avoid committing local data.

---

## Team Policy

A repository can share settings through a `tpt-policy.json` file at its root, which you commit:

```json
{
  "vault": { "customRegex": ["acme-key-[A-Za-z0-9]{32}"] },
  "costBudget": { "dailyLimitUsd": 5 },
  "dryRun": false
}
```

A policy can only tighten your settings: it adds Vault patterns, lowers cost budgets, and can turn dry run on. It cannot add router rules or change the provider, so a repository cannot send your code to another provider. The policy applies only after you choose **Trust and apply** when VS Code asks. The trust is for that exact file, so a changed policy asks again. A file that is not valid JSON is ignored, with a warning. **TPT: Show Workspace Policy** says what TPT made of it.

---

## Building from Source

```bash
git clone https://github.com/PhillipC05/tpt-code-command-center
cd tpt-code-command-center
npm install
npm run compile
```

Press `F5` in VS Code to launch the Extension Development Host.

To package a `.vsix`:

```bash
npm install -g @vscode/vsce
vsce package
```

---

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md).

---

## License

Dual-licensed under either of [MIT](LICENSE-MIT) or [Apache 2.0](LICENSE-APACHE), at your option.
