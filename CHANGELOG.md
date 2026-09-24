# Changelog

All notable changes to this project will be documented here.

The format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
This project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- **TPT Weave (tpt-weave integration)** — for workspaces indexed with `tpt-weave adopt`, Rust tool-result content is replaced by the repository's indexed signatures/skeletons (`tpt.weave.enabled`, level via `tpt.weave.level`) instead of re-parsing sources in the proxy; falls back to tree-sitter/regex outlining on any miss. Dashboard gains a "Repository Context (tpt-weave)" panel (raw vs delivered tokens, reduction, cache hit rate, session replacements).
- **Live OpenRouter pricing** — fetches `/api/v1/models` once per day, cached in `.tpt/pricing.json`. Falls back to a built-in table covering all major providers when offline.
- **Daily cost budget alert** — `tpt.costBudget.dailyLimitUsd` setting; warning notification fires once per day when spending exceeds the limit.
- **Per-model cost breakdown** — dashboard now shows a "Cost by Model" table and a budget progress bar.
- **tree-sitter WASM bundling** — `scripts/download-wasm.js` downloads pre-built language grammar WASM files (TypeScript, JavaScript, Python, Go, Rust, Java, C#, PHP, Ruby) to `media/wasm/`. Run `npm run download-wasm` before packaging.
- **Smart Context path detection** — reads file extension from the tool call `path`/`input.path` argument directly rather than scanning content for a filename pattern.
- **Integration test** — proxy pass-through test with a real mock upstream HTTP server (`src/test/integration/`).
- **Model picker** — `TPT: Configure Models` command for picking Memory Weaver summarisation models with live Ollama discovery.
- Streaming response support (SSE for both Anthropic and OpenAI formats)
- `.vscode/launch.json` for F5 development workflow
- Unit tests for Vault regex, hash normalisation, and Router rule matching
- Built-in default Router rules

---

## [0.1.0] — 2026-06-18

### Added
- **Extension-hosted local HTTP proxy** — starts automatically on VS Code launch, shuts down on close. Dynamic port binding starting at 7331. Session token security on all requests.
- **ANTHROPIC_BASE_URL injection** — automatically injected into all VS Code terminal environments so Claude Code routes through the proxy without any manual setup.
- **Upstream provider support** — OpenRouter (default), Anthropic direct, OpenAI direct, local (Ollama/LM Studio), and custom base URL. All configurable via VS Code settings.
- **Both API formats** — handles Anthropic Messages format (`/v1/messages`) and OpenAI Chat Completions format (`/v1/chat/completions`).
- **TPT Vault** — regex-based redaction of AWS keys, Stripe tokens, GitHub PATs, JWTs, `.env` patterns, SSH private keys, and user-defined custom patterns.
- **TPT Smart Context** — replaces large file contents in AI tool results with compact AST outlines using `web-tree-sitter`. Falls back to regex-based outline extraction when no parser is available.
- **TPT Token Shield** — SHA-256 hash-based exact-match prompt cache backed by `sql.js`. Configurable size cap with LRU eviction.
- **TPT Memory Weaver** — summarises conversation history when token count exceeds a threshold. Supports Ollama, proxy LLM, and extractive fallback in a user-configurable priority order.
- **TPT Router** — rewrites the target model and upstream provider based on heuristic rules matching token count, keywords, and file extensions.
- **TPT Silent Edit** — injects a JSON edit schema into system prompts and applies matching AI responses as native undoable `WorkspaceEdit` diffs.
- **TPT Forge** — fetches and installs community router rules, vault patterns, and system prompts from a public GitHub registry.
- **TPT Terminal** — Output Channel with live pipeline logs. Verbose mode shows per-request detail.
- **Status bar item** — green/yellow/red shield icon with Quick Pick toggle menu for all modules.
- **WebView dashboard** — token ledger stats, 7-day cost chart, active module map.
- **Command Palette** — all functions accessible via `Ctrl+Shift+P` (`TPT: ...`).
- **Token Ledger** — records every request (model, tokens in/out, cost, cache hit, module actions) in a local `sql.js` database at `.tpt/ledger.db`.
- **No native modules** — uses `sql.js` (WASM) instead of `better-sqlite3`. Installs cleanly on Windows, macOS, and Linux without compilation.
